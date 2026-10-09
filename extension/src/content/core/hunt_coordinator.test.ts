import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { HuntCoordinator, ARMED_SESSION_KEY } from "./hunt_coordinator";
import { timeSyncClient } from "./time_sync_client";
import { storage } from "../../lib/storage";
import { ScheduledTask } from "../../lib/types";

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

    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({ success: true }),
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

  it("H4: disarm sends TASK_STATUS_UPDATE cancelled when taskId exists", () => {
    const updateSpy = vi.spyOn(storage, "updateTaskStatus").mockResolvedValue();

    coordinator.arm({
      targetTimestamp: 1_010_000,
      targetElement: testBtn,
      taskId: "task-123",
      label: "Sniper · Voucher",
    });

    coordinator.disarm();

    expect(updateSpy).toHaveBeenCalledWith("task-123", "cancelled");
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      action: "CANCEL_TASK",
      taskId: "task-123",
    }));
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

  it("H2: armFromTask marks task missed and aborts if now is past targetDeadline + 15s", async () => {
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
    expect(updateSpy).toHaveBeenCalledWith("expired-task", "missed", expect.objectContaining({
      result: "timeout",
      clicks: 0,
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
  });

  it("checkAndResumeArmedSession restores session from sessionStorage and re-arms coordinator", () => {
    sessionStorage.setItem(ARMED_SESSION_KEY, JSON.stringify({
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
    }));

    const restored = coordinator.checkAndResumeArmedSession();
    expect(restored).toBe(true);
    expect(coordinator.isArmed()).toBe(true);
    expect(coordinator.getState().targetTimestamp).toBe(1_050_000);
  });

  it("checkAndResumeArmedSession rejects session if URL does not match", () => {
    sessionStorage.setItem(ARMED_SESSION_KEY, JSON.stringify({
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
    }));

    const restored = coordinator.checkAndResumeArmedSession();
    expect(restored).toBe(false);
    expect(coordinator.isArmed()).toBe(false);
    expect(sessionStorage.getItem(ARMED_SESSION_KEY)).toBeNull();
  });
});
