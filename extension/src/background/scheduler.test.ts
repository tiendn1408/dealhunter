import { describe, it, expect, beforeEach, vi } from "vitest";
import { taskScheduler } from "./scheduler";
import { timeCalibrator } from "./time_calibrator";
import { ScheduledTask } from "../lib/types";

let alarms: Record<string, { when?: number }>;
let localStore: Record<string, unknown>;
let createdTabs: { id: number; url: string; active?: boolean }[];
let updatedTabs: { tabId: number; props: unknown }[];
let sentMessages: { tabId: number; msg: unknown }[];

beforeEach(() => {
  alarms = {};
  localStore = {};
  createdTabs = [];
  updatedTabs = [];
  sentMessages = [];

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
      reload: vi.fn(async () => {}),
      sendMessage: vi.fn(async (tabId: number, msg: unknown) => {
        sentMessages.push({ tabId, msg });
        return { received: true };
      }),
    },
    windows: {
      update: vi.fn(async () => ({})),
    },
  });
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
      url: "https://app.caffiliate.vn/mission?tab=daily",
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
});
