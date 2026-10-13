import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { HuntCoordinator, ARMED_SESSION_KEY } from "./hunt_coordinator";
import { timeSyncClient } from "./time_sync_client";
import { storage } from "../../lib/storage";
import { ScheduledTask } from "../../lib/types";
import { sessionVault } from "./session_vault";

let vaultStore: Record<string, unknown> = {};

/** A session the extension itself armed before a reload: in its vault, with the token in sessionStorage. */
async function storeArmedSession(session: Record<string, unknown>) {
  const token = "token-" + Math.random().toString(36).slice(2);
  await sessionVault.save(token, { ...session, token });
  sessionStorage.setItem(ARMED_SESSION_KEY, JSON.stringify({ token }));
}

describe("HuntCoordinator", () => {
  let coordinator: HuntCoordinator;
  let testBtn: HTMLButtonElement;

  beforeEach(() => {
    sessionStorage.clear();
    coordinator = new HuntCoordinator();
    testBtn = document.createElement("button");
    testBtn.id = "btn-target";
    testBtn.textContent = "Lưu";
    document.body.appendChild(testBtn);

    vi.spyOn(timeSyncClient, "getServerTime").mockReturnValue(1_000_000);
    vi.spyOn(timeSyncClient, "init").mockResolvedValue(undefined as any);

    vaultStore = {};
    vi.stubGlobal("chrome", {
      runtime: {
        id: "test-extension",
        sendMessage: vi.fn().mockResolvedValue({ success: true }),
      },
      storage: {
        local: {
          get: async (key: string) => ({ [key]: structuredClone(vaultStore[key]) }),
          set: async (items: Record<string, unknown>) => Object.assign(vaultStore, structuredClone(items)),
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    sessionStorage.clear();
    document.body.innerHTML = "";
  });

  it("arms with target element and updates coordinator state", () => {
    const states: boolean[] = [];
    coordinator.subscribe((s) => states.push(s.isArmed));

    coordinator.arm({
      targetTimestamp: 1_010_000,
      targetElement: testBtn,
      label: "Sniper · Lưu",
    });

    expect(coordinator.isArmed()).toBe(true);
    expect(coordinator.getState().targetTimestamp).toBe(1_010_000);
    expect(coordinator.getState().tone).toBe("armed");
    expect(states).toContain(true);

    const saved = JSON.parse(sessionStorage.getItem(ARMED_SESSION_KEY) || "{}");
    expect(saved.targetTimestamp).toBe(1_010_000);
  });

  it("disarms cleanly and clears session from sessionStorage", () => {
    coordinator.arm({
      targetTimestamp: 1_010_000,
      targetElement: testBtn,
      label: "Sniper · Test",
    });

    expect(coordinator.isArmed()).toBe(true);
    coordinator.disarm();

    expect(coordinator.isArmed()).toBe(false);
    expect(coordinator.getState().tone).toBe("idle");
    expect(sessionStorage.getItem(ARMED_SESSION_KEY)).toBeNull();
  });

  it("H4: disarming a scheduled run reports it cancelled once, never deletes the task or writes storage", () => {
    const updateSpy = vi.spyOn(storage, "updateTaskStatus").mockResolvedValue();

    coordinator.arm({
      targetTimestamp: 1_010_000,
      targetElement: testBtn,
      taskId: "task-123",
      label: "Sniper · Voucher",
    });

    coordinator.disarm();

    const sent = (chrome.runtime.sendMessage as any).mock.calls.map((c: any[]) => c[0]);
    expect(sent.filter((m: any) => m.action === "CANCEL_TASK")).toHaveLength(0);
    const statuses = sent.filter((m: any) => m.action === "TASK_STATUS_UPDATE");
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({ taskId: "task-123", status: "cancelled" });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("M3: adopts taskId into existing manual session with same timestamp without restarting", () => {
    coordinator.arm({
      targetTimestamp: 1_010_000,
      targetElement: testBtn,
      label: "Manual · Voucher",
    });

    expect(coordinator.getState().taskId).toBeUndefined();

    // Secondary arm call with same timestamp adopts task ID
    coordinator.arm({
      targetTimestamp: 1_010_000,
      targetElement: testBtn,
      taskId: "task-adopted-999",
      label: "Auto · Voucher",
    });

    expect(coordinator.getState().taskId).toBe("task-adopted-999");
    expect(coordinator.isArmed()).toBe(true);
  });

  it("H2: armFromTask reports the task missed and aborts if now is past targetDeadline + 15s", async () => {
    vi.spyOn(timeSyncClient, "getServerTime").mockReturnValue(1_020_000);
    const updateSpy = vi.spyOn(storage, "updateTaskStatus").mockResolvedValue();

    const expiredTask: ScheduledTask = {
      id: "expired-task",
      label: "Expired task",
      targetHour: 0,
      targetMinute: 0,
      targetAt: 1_000_000, // 20s in the past (> 15s grace)
      targetUrl: window.location.href,
      mode: "full_auto",
      status: "pending",
      createdAt: 900_000,
    };

    await coordinator.armFromTask(expiredTask);

    expect(coordinator.isArmed()).toBe(false);
    // Reported to the background (which rolls a daily task over), not written from the page
    expect(updateSpy).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      action: "TASK_STATUS_UPDATE",
      taskId: "expired-task",
      status: "missed",
      result: expect.objectContaining({ result: "timeout", clicks: 0 }),
    }));
  });

  it("disables dualDefenseReload when diagnostics strategy is reactive_no_reload", () => {
    coordinator.arm({
      targetTimestamp: 1_010_000,
      targetElement: testBtn,
      dualDefenseReload: true,
      diagnostics: {
        strategy: "reactive_no_reload",
        framework: "react",
        hasCountdownTimer: true,
        isTicking: true,
        isStandby: true,
        confidence: 0.9,
      },
    });

    const saved = JSON.parse(sessionStorage.getItem(ARMED_SESSION_KEY) || "{}");
    expect(saved.dualDefenseReload).toBe(false);
    expect(saved.reloadSwitch).toBe(true); // the user's switch is kept for the HUD
  });

  it("uses the pre-reload lead measured for this page unless one is given", async () => {
    const { reloadTiming } = await import("../../lib/reload_timing");
    vi.spyOn(reloadTiming, "leadFor").mockReturnValue(1830);
    coordinator.arm({ targetTimestamp: 1_010_000, targetElement: testBtn });
    expect(JSON.parse(sessionStorage.getItem(ARMED_SESSION_KEY) || "{}").preReloadLeadMs).toBe(1830);

    coordinator.arm({ targetTimestamp: 1_020_000, targetElement: testBtn, preReloadLeadMs: 900 });
    expect(JSON.parse(sessionStorage.getItem(ARMED_SESSION_KEY) || "{}").preReloadLeadMs).toBe(900);
    vi.restoreAllMocks();
  });

  it("checkAndResumeArmedSession restores the extension's stored session and re-arms coordinator", async () => {
    await storeArmedSession({
      targetTimestamp: 1_050_000,
      label: "Restored Session",
      url: window.location.href,
      armedAt: 1_000_000,
      descriptor: {
        id: "btn-target",
        uniqueSelector: "#btn-target",
        tagName: "BUTTON",
        initialText: "Lưu",
      },
    });

    const restored = await coordinator.checkAndResumeArmedSession();
    expect(restored).toBe(true);
    expect(coordinator.isArmed()).toBe(true);
    expect(coordinator.getState().targetTimestamp).toBe(1_050_000);
  });

  it("checkAndResumeArmedSession rejects session if URL does not match", async () => {
    await storeArmedSession({
      targetTimestamp: 1_050_000,
      label: "Restored Session",
      url: "https://example.com/other-page",
      armedAt: 1_000_000,
      descriptor: {
        id: "btn-target",
        uniqueSelector: "#btn-target",
        tagName: "BUTTON",
        initialText: "Lưu",
      },
    });

    const restored = await coordinator.checkAndResumeArmedSession();
    expect(restored).toBe(false);
    expect(coordinator.isArmed()).toBe(false);
    expect(sessionStorage.getItem(ARMED_SESSION_KEY)).toBeNull();
  });

  it("armFromTask propagates dualDefenseReload and diagnostics into arm session", async () => {
    const task: ScheduledTask = {
      id: "task-diag-preserve",
      targetHour: 0,
      targetMinute: 0,
      targetSecond: 0,
      targetAt: 1_020_000,
      targetUrl: window.location.href,
      label: "Preserve Diag Test",
      mode: "full_auto",
      status: "pending",
      dualDefenseReload: false,
      diagnostics: {
        strategy: "reactive_no_reload",
        framework: "react",
        hasCountdownTimer: true,
        isTicking: true,
        isStandby: true,
        confidence: 0.95,
      },
      descriptor: {
        id: "btn-target",
        uniqueSelector: "#btn-target",
        tagName: "BUTTON",
        attributes: {},
        initialText: "Lưu",
      },
      createdAt: 1_000_000,
    };

    await coordinator.armFromTask(task);

    expect(coordinator.isArmed()).toBe(true);
    const session = JSON.parse(sessionStorage.getItem(ARMED_SESSION_KEY) || "{}");
    expect(session.dualDefenseReload).toBe(false);
    expect(session.diagnostics?.strategy).toBe("reactive_no_reload");
  });

  it("checkAndResumeArmedSession preserves dualDefenseReload and diagnostics across reload", async () => {
    await storeArmedSession({
      targetTimestamp: 1_050_000,
      label: "Restored Session",
      url: window.location.href,
      armedAt: 1_000_000,
      dualDefenseReload: false,
      diagnostics: {
        strategy: "reactive_no_reload",
        framework: "react",
        hasCountdownTimer: true,
        isTicking: true,
        isStandby: true,
        confidence: 0.95,
      },
      descriptor: {
        id: "btn-target",
        uniqueSelector: "#btn-target",
        tagName: "BUTTON",
        initialText: "Lưu",
      },
    });

    const restored = await coordinator.checkAndResumeArmedSession();
    expect(restored).toBe(true);
    expect(coordinator.isArmed()).toBe(true);
    const session = JSON.parse(sessionStorage.getItem(ARMED_SESSION_KEY) || "{}");
    expect(session.dualDefenseReload).toBe(false);
    expect(session.diagnostics?.strategy).toBe("reactive_no_reload");
  });

  it("clearTargetAndOutcome resets targetSummary, outcome, clicks, and session cleanly", () => {
    coordinator.arm({
      targetTimestamp: 1_010_000,
      targetElement: testBtn,
      label: "Sniper · Target Button",
    });

    expect(coordinator.getState().targetSummary).toBe("Target Button");
    expect(sessionStorage.getItem(ARMED_SESSION_KEY)).not.toBeNull();

    const listenerSnaps: Array<{ summary: string | null; outcome: any; isArmed: boolean }> = [];
    coordinator.subscribe((s) =>
      listenerSnaps.push({ summary: s.targetSummary, outcome: s.outcome, isArmed: s.isArmed })
    );

    coordinator.clearTargetAndOutcome();

    const latest = coordinator.getState();
    expect(latest.targetSummary).toBeNull();
    expect(latest.outcome).toBeUndefined();
    expect(latest.isArmed).toBe(false);
    expect(latest.clicks).toBe(0);
    expect(latest.statusText).toBe("");
    expect(latest.tone).toBe("idle");
    expect(sessionStorage.getItem(ARMED_SESSION_KEY)).toBeNull();

    const lastSnap = listenerSnaps[listenerSnaps.length - 1];
    expect(lastSnap.summary).toBeNull();
    expect(lastSnap.outcome).toBeUndefined();
    expect(lastSnap.isArmed).toBe(false);

    // Any new subscriber after clear must receive clean null target and undefined outcome
    let subscriberInitial: any = null;
    const unsub = coordinator.subscribe((s) => {
      subscriberInitial = s;
    });
    unsub();
    expect(subscriberInitial.targetSummary).toBeNull();
    expect(subscriberInitial.outcome).toBeUndefined();
  });

  it("resetOutcome clears outcome and clicks while preserving targetSummary when unarmed", () => {
    coordinator.arm({
      targetTimestamp: 1_010_000,
      targetElement: testBtn,
      label: "Sniper · Test Button",
    });

    coordinator.disarm();
    expect(coordinator.getState().targetSummary).toBe("Test Button");

    // Manually simulate a finished outcome via private method / state
    (coordinator as any).handleDone({
      result: "timeout",
      clicks: 24,
      detail: "Clicked but unconfirmed",
    });

    expect(coordinator.getState().outcome).toBeDefined();
    expect(coordinator.getState().clicks).toBe(24);
    expect(coordinator.getState().targetSummary).toBe("Test Button");

    coordinator.resetOutcome();

    const state = coordinator.getState();
    expect(state.outcome).toBeUndefined();
    expect(state.clicks).toBe(0);
    expect(state.tone).toBe("idle");
    expect(state.statusText).toBe("");
    expect(state.targetSummary).toBe("Test Button");
  });
});
