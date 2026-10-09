import { describe, it, expect, beforeEach, vi } from "vitest";
import { taskScheduler } from "./scheduler";
import { timeCalibrator } from "./time_calibrator";
import { ScheduledTask } from "../lib/types";

let alarms: Record<string, { when?: number }>;
let localStore: Record<string, unknown>;
let createdTabs: { id: number; url: string; active?: boolean }[];
let updatedTabs: { tabId: number; props: unknown }[];
let sentMessages: { tabId: number; msg: unknown }[];
let onUpdatedListeners: ((tabId: number, changeInfo: { status?: string }) => void)[];
let onRemovedListeners: ((tabId: number) => void)[];

beforeEach(() => {
  alarms = {};
  localStore = {};
  createdTabs = [];
  updatedTabs = [];
  sentMessages = [];
  onUpdatedListeners = [];
  onRemovedListeners = [];

  vi.spyOn(timeCalibrator, "calibrate").mockResolvedValue({
    offsetMs: 0,
    rttMs: 20,
    errorMs: 10,
    calibrated: true,
    lastCalibratedAt: Date.now(),
    serverHost: "app.caffiliate.vn",
  });

  vi.stubGlobal("chrome", {
    alarms: {
      create: vi.fn((name: string, info: { when?: number }) => {
        alarms[name] = info;
      }),
      clear: vi.fn((name: string) => {
        delete alarms[name];
      }),
    },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: localStore[key] }),
        set: async (items: Record<string, unknown>) => Object.assign(localStore, items),
        remove: async (key: string) => void delete localStore[key],
      },
    },
    tabs: {
      query: vi.fn(async () => []),
      create: vi.fn(async (props: { url: string; active?: boolean }) => {
        const tab = { id: 101, url: props.url, active: props.active, status: "complete" };
        createdTabs.push(tab);
        return tab;
      }),
      update: vi.fn(async (tabId: number, props?: Record<string, unknown>) => {
        updatedTabs.push({ tabId, props });
        return { id: tabId, ...(props || {}) };
      }),
      get: vi.fn(async (tabId: number) => ({ id: tabId, status: "complete" })),
      reload: vi.fn(async (tabId: number) => {
        setTimeout(() => {
          onUpdatedListeners.forEach((l) => l(tabId, { status: "complete" }));
        }, 5);
      }),
      sendMessage: vi.fn(async (tabId: number, msg: unknown) => {
        sentMessages.push({ tabId, msg });
        return { received: true };
      }),
      onUpdated: {
        addListener: vi.fn((fn: any) => onUpdatedListeners.push(fn)),
        removeListener: vi.fn((fn: any) => {
          onUpdatedListeners = onUpdatedListeners.filter((l) => l !== fn);
        }),
      },
      onRemoved: {
        addListener: vi.fn((fn: any) => onRemovedListeners.push(fn)),
        removeListener: vi.fn((fn: any) => {
          onRemovedListeners = onRemovedListeners.filter((l) => l !== fn);
        }),
      },
    },
    windows: {
      update: vi.fn(async () => ({})),
    },
  });

  taskScheduler.setupTabRemovedListener();
});

describe("taskScheduler", () => {
  it("schedules an exact HH:mm:ss task with custom preWarmSeconds", async () => {
    const task: ScheduledTask = {
      id: "task-exact-1",
      targetHour: 20,
      targetMinute: 29,
      targetSecond: 0,
      targetUrl: "https://app.caffiliate.vn/mission",
      label: "20:29:00 · Diem Danh",
      mode: "full_auto",
      savedTargetId: "saved-1",
      descriptor: {
        id: "btn-checkin",
        uniqueSelector: "button#btn-checkin",
        tagName: "BUTTON",
        attributes: { class: "btn" },
        initialText: "DIEM DANH (+1)",
      },
      preWarmSeconds: 30,
      status: "pending",
      createdAt: Date.now(),
    };

    await taskScheduler.scheduleTask(task);

    expect(chrome.alarms.create).toHaveBeenCalled();
    const alarmInfo = alarms["dh_task_task-exact-1"];
    expect(alarmInfo).toBeDefined();
    expect(alarmInfo.when).toBeGreaterThan(Date.now());
  });

  it("reuses and focuses existing tab if already open instead of creating duplicate", async () => {
    const existingTab = {
      id: 999,
      url: "https://app.caffiliate.vn/mission?utm_source=fb",
      windowId: 1,
      status: "complete",
    };

    vi.mocked(chrome.tabs.query).mockResolvedValueOnce([existingTab as any]);

    const task: ScheduledTask = {
      id: "task-open-tab",
      targetHour: 0,
      targetMinute: 0,
      targetSecond: 0,
      targetUrl: "https://app.caffiliate.vn/mission",
      label: "00:00:00 · Caffiliate",
      mode: "full_auto",
      status: "pending",
      createdAt: Date.now(),
    };

    // Store task
    await taskScheduler.scheduleTask(task);

    // Trigger alarm
    await taskScheduler.handleAlarm({
      name: "dh_task_task-open-tab",
      scheduledTime: Date.now(),
    });

    // Should NOT create new tab
    expect(createdTabs.length).toBe(0);
    // Should focus existing tab
    expect(chrome.tabs.update).toHaveBeenCalledWith(999, { active: true });
    // Should dispatch trigger message to existing tab
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      999,
      expect.objectContaining({
        action: "TRIGGER_FULL_AUTO",
      })
    );
  });

  it("H1: restores alarms for pending tasks and marks expired tasks as missed on startup", async () => {
    const now = Date.now();
    const activeTask: ScheduledTask = {
      id: "active-task-1",
      targetHour: 23,
      targetMinute: 59,
      targetSecond: 0,
      targetAt: now + 3600_000, // 1 hour in future
      targetUrl: "https://shopee.vn/m/voucher",
      label: "Future Drop",
      mode: "full_auto",
      status: "pending",
      createdAt: now,
    };
    const expiredTask: ScheduledTask = {
      id: "expired-task-2",
      targetHour: 10,
      targetMinute: 0,
      targetSecond: 0,
      targetAt: now - 3600_000, // 1 hour in past
      targetUrl: "https://shopee.vn/m/voucher",
      label: "Past Drop",
      mode: "full_auto",
      status: "pending",
      createdAt: now - 7200_000,
    };

    await taskScheduler.scheduleTask(activeTask);
    await taskScheduler.scheduleTask(expiredTask);

    // Clear alarm mocks to simulate fresh browser startup
    alarms = {};

    await taskScheduler.restorePendingAlarms();

    // Active task must have an alarm restored
    expect(alarms["dh_task_active-task-1"]).toBeDefined();
    // Expired task must not have an alarm and must be marked missed in storage
    expect(alarms["dh_task_expired-task-2"]).toBeUndefined();
    const tasks = (localStore["dh_scheduled_tasks"] as ScheduledTask[]) || [];
    const missed = tasks.find((t) => t.id === "expired-task-2");
    expect(missed?.status).toBe("missed");
  });

  it("H2: handleAlarm marks task as missed if alarm fired past drop deadline (+15s)", async () => {
    const now = Date.now();
    const lateTask: ScheduledTask = {
      id: "late-alarm-task",
      targetHour: 12,
      targetMinute: 0,
      targetSecond: 0,
      targetAt: now - 30_000, // Drop was 30 seconds ago (past 15s grace)
      targetUrl: "https://shopee.vn/m/voucher",
      label: "Late Alarm",
      mode: "full_auto",
      status: "pending",
      createdAt: now - 60_000,
    };

    await taskScheduler.scheduleTask(lateTask);

    // Alarm triggers now
    await taskScheduler.handleAlarm({
      name: "dh_task_late-alarm-task",
      scheduledTime: now,
    });

    // Should NOT create or message any tabs
    expect(createdTabs.length).toBe(0);
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();

    // Task must be marked missed in storage
    const tasks = (localStore["dh_scheduled_tasks"] as ScheduledTask[]) || [];
    const saved = tasks.find((t) => t.id === "late-alarm-task");
    expect(saved?.status).toBe("missed");
  });

  it("H4: cancelTask clears alarm, removes task, and notifies open tabs", async () => {
    const matchingTab = {
      id: 555,
      url: "https://shopee.vn/m/flash-sale?id=1",
      status: "complete",
    };
    vi.mocked(chrome.tabs.query).mockResolvedValueOnce([matchingTab as any]);

    const task: ScheduledTask = {
      id: "task-to-cancel",
      targetHour: 23,
      targetMinute: 59,
      targetSecond: 0,
      targetUrl: "https://shopee.vn/m/flash-sale?id=1",
      label: "To Cancel",
      mode: "full_auto",
      status: "running",
      createdAt: Date.now(),
    };

    await taskScheduler.scheduleTask(task);
    expect(alarms["dh_task_task-to-cancel"]).toBeDefined();

    await taskScheduler.cancelTask("task-to-cancel");

    // Alarm cleared
    expect(alarms["dh_task_task-to-cancel"]).toBeUndefined();
    // Tab notified
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(555, {
      action: "CANCEL_TASK",
      taskId: "task-to-cancel",
    });
  });

  it("H7: tab matching does not reuse tabs with different functional query parameters", async () => {
    const otherTab = {
      id: 777,
      url: "https://shopee.vn/event?cat=2",
      status: "complete",
    };
    vi.mocked(chrome.tabs.query).mockResolvedValueOnce([otherTab as any]);

    const task: ScheduledTask = {
      id: "task-cat-1",
      targetHour: 0,
      targetMinute: 0,
      targetSecond: 0,
      targetUrl: "https://shopee.vn/event?cat=1",
      label: "Event Cat 1",
      mode: "full_auto",
      status: "pending",
      createdAt: Date.now(),
    };

    await taskScheduler.scheduleTask(task);

    await taskScheduler.handleAlarm({
      name: "dh_task_task-cat-1",
      scheduledTime: Date.now(),
    });

    // Since otherTab is cat=2, it must NOT reuse tab 777; it must create a new tab for cat=1!
    expect(createdTabs.length).toBe(1);
    expect(createdTabs[0].url).toBe("https://shopee.vn/event?cat=1");
  });

  it("M2: waits for tab reload to complete before sending trigger message", async () => {
    const existingTab = {
      id: 888,
      url: "https://shopee.vn/flash_sale",
      windowId: 1,
      status: "complete",
    };

    vi.mocked(chrome.tabs.query).mockResolvedValueOnce([existingTab as any]);

    const task: ScheduledTask = {
      id: "task-reload-test",
      targetHour: 0,
      targetMinute: 0,
      targetSecond: 0,
      targetUrl: "https://shopee.vn/flash_sale",
      label: "Flash Sale",
      mode: "full_auto",
      status: "pending",
      createdAt: Date.now(),
    };

    await taskScheduler.scheduleTask(task);

    // Override reload for this test so onUpdated is not fired automatically
    vi.mocked(chrome.tabs.reload).mockImplementationOnce(async () => {});

    // Call handleAlarm asynchronously
    let alarmFinished = false;
    const alarmPromise = taskScheduler.handleAlarm({
      name: "dh_task_task-reload-test",
      scheduledTime: Date.now(),
    }).then(() => {
      alarmFinished = true;
    });

    // Give microtasks time to execute reload
    await new Promise((r) => setTimeout(r, 10));

    expect(chrome.tabs.reload).toHaveBeenCalledWith(888);

    // Trigger should NOT have been sent yet because reload hasn't completed!
    const triggerMsgBefore = sentMessages.find(
      (m) => m.tabId === 888 && (m.msg as any)?.action === "TRIGGER_FULL_AUTO"
    );
    expect(triggerMsgBefore).toBeUndefined();
    expect(alarmFinished).toBe(false);

    // Now fire onUpdated with status: complete for tab 888
    for (const listener of onUpdatedListeners) {
      listener(888, { status: "complete" });
    }

    await alarmPromise;

    // Now trigger message should have been sent to tab 888
    const triggerMsgAfter = sentMessages.find(
      (m) => m.tabId === 888 && (m.msg as any)?.action === "TRIGGER_FULL_AUTO"
    );
    expect(triggerMsgAfter).toBeDefined();
  });

  it("marks running task as failed if its target tab is closed before drop", async () => {
    const task: ScheduledTask = {
      id: "task-tab-close",
      targetHour: 0,
      targetMinute: 0,
      targetSecond: 0,
      targetUrl: "https://shopee.vn/flash_sale",
      label: "Flash Sale",
      mode: "full_auto",
      status: "pending",
      createdAt: Date.now(),
    };

    await taskScheduler.scheduleTask(task);
    await taskScheduler.handleAlarm({
      name: "dh_task_task-tab-close",
      scheduledTime: Date.now(),
    });

    const tasksAfterAlarm = await chrome.storage.local.get("dh_scheduled_tasks");
    const activeTask = (tasksAfterAlarm.dh_scheduled_tasks as ScheduledTask[]).find((t) => t.id === "task-tab-close");
    expect(activeTask?.status).toBe("running");

    // Close the created tab 101
    for (const listener of onRemovedListeners) {
      await listener(101);
    }

    const tasksAfterClose = await chrome.storage.local.get("dh_scheduled_tasks");
    const closedTask = (tasksAfterClose.dh_scheduled_tasks as ScheduledTask[]).find((t) => t.id === "task-tab-close");
    expect(closedTask?.status).toBe("failed");
    expect(closedTask?.lastResult?.detail).toBe("Target tab was closed before drop");
  });
});

