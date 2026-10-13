import { describe, it, expect, beforeEach, vi } from "vitest";
import { taskScheduler } from "./scheduler";
import { timeCalibrator } from "./time_calibrator";
import { ScheduledTask } from "../lib/types";
import { STORAGE_KEYS } from "../lib/constants";

// Task lifecycle regressions: lost updates between concurrent writers, stale/legacy tasks firing on a
// later day, daily series broken by a cancel or a lost result, and the background clock probe.

let alarms: Record<string, { when?: number }>;
let localStore: Record<string, unknown>;

/** Storage that yields between read and write, like the real async chrome.storage. */
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.restoreAllMocks();
  alarms = {};
  localStore = {};
  vi.stubGlobal("chrome", {
    alarms: {
      create: vi.fn((name: string, info: { when?: number }) => {
        alarms[name] = info;
      }),
      clear: vi.fn(async (name: string) => {
        delete alarms[name];
      }),
    },
    storage: {
      local: {
        get: async (key: string) => {
          await tick();
          return { [key]: structuredClone(localStore[key]) };
        },
        set: async (items: Record<string, unknown>) => {
          await tick();
          Object.assign(localStore, structuredClone(items));
        },
        remove: async (key: string) => void delete localStore[key],
      },
    },
    tabs: {
      query: vi.fn(async () => []),
      sendMessage: vi.fn(async () => ({})),
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    windows: { update: vi.fn(async () => ({})) },
  });
});

const HOUR = 3_600_000;
const tasks = () => localStore[STORAGE_KEYS.SCHEDULED_TASKS] as ScheduledTask[];
const byId = (id: string) => tasks().find((t) => t.id === id)!;

function task(id: string, extra: Partial<ScheduledTask>): ScheduledTask {
  const d = new Date(Date.now() + HOUR);
  return {
    id,
    targetHour: d.getHours(),
    targetMinute: d.getMinutes(),
    targetSecond: d.getSeconds(),
    targetUrl: "https://shop.vn/flash",
    label: id,
    mode: "full_auto",
    preWarmSeconds: 60,
    status: "pending",
    createdAt: Date.now() - 2 * HOUR,
    ...extra,
  } as ScheduledTask;
}

describe("restoring alarms on startup", () => {
  it("a daily task rolled over in the same pass does not bring a missed task back to pending", async () => {
    const past = Date.now() - HOUR;
    localStore[STORAGE_KEYS.SCHEDULED_TASKS] = [
      task("A", { targetAt: past, isDaily: false }),
      task("B", { targetAt: past, isDaily: true }),
    ];
    await taskScheduler.restorePendingAlarms();
    expect(byId("A").status).toBe("missed");
    expect(byId("B").status).toBe("pending");
    expect(byId("B").targetAt!).toBeGreaterThan(Date.now());
    expect(alarms["dh_task_A"]).toBeUndefined();
    expect(alarms["dh_task_B"]).toBeDefined();
  });

  it("a legacy task without targetAt that never ran is not re-armed for a later day", async () => {
    // Created 30 hours ago for a time that already came and went
    const createdAt = Date.now() - 30 * HOUR;
    const d = new Date(createdAt + HOUR);
    localStore[STORAGE_KEYS.SCHEDULED_TASKS] = [
      task("L", {
        createdAt,
        targetHour: d.getHours(),
        targetMinute: d.getMinutes(),
        targetSecond: d.getSeconds(),
        status: "running",
      }),
    ];
    await taskScheduler.restorePendingAlarms();
    expect(byId("L").status).toBe("missed");
    expect(alarms["dh_task_L"]).toBeUndefined();
  });

  it("a daily task stuck in running (result lost) moves on to its next drop", async () => {
    localStore[STORAGE_KEYS.SCHEDULED_TASKS] = [task("D", { isDaily: true, status: "running", targetAt: Date.now() - 5 * 60_000 })];
    await taskScheduler.restorePendingAlarms();
    expect(byId("D").status).toBe("pending");
    expect(byId("D").targetAt!).toBeGreaterThan(Date.now());
    expect(alarms["dh_task_D"]?.when).toBeGreaterThan(Date.now());
  });
});

describe("status updates", () => {
  it("two results arriving together are both kept (daily roll-over included)", async () => {
    localStore[STORAGE_KEYS.SCHEDULED_TASKS] = [
      task("D", { isDaily: true, status: "running", targetAt: Date.now() - 5_000 }),
      task("E", { status: "running", targetAt: Date.now() - 5_000 }),
    ];
    await Promise.all([
      taskScheduler.handleTaskStatusUpdate("D", "completed", { result: "saved", clicks: 1, detail: "ok", finishedAt: Date.now() }),
      taskScheduler.handleTaskStatusUpdate("E", "completed", { result: "saved", clicks: 1, detail: "ok", finishedAt: Date.now() }),
    ]);
    expect(byId("E").status).toBe("completed");
    expect(byId("D").status).toBe("pending");
    expect(byId("D").targetAt!).toBeGreaterThan(Date.now());
    expect(byId("D").lastResult?.result).toBe("saved");
  });

  it("disarming one run of a daily task skips today only; the series continues", async () => {
    localStore[STORAGE_KEYS.SCHEDULED_TASKS] = [task("D", { isDaily: true, status: "running", targetAt: Date.now() + 30_000 })];
    await taskScheduler.handleTaskStatusUpdate("D", "cancelled", { result: "cancelled", clicks: 0, detail: "Cancelled", finishedAt: Date.now() });
    expect(byId("D").status).toBe("pending");
    expect(byId("D").targetAt!).toBeGreaterThan(Date.now() + 60_000);
    expect(alarms["dh_task_D"]).toBeDefined();
  });

  it("disarming a one-off task keeps it in the list as cancelled", async () => {
    localStore[STORAGE_KEYS.SCHEDULED_TASKS] = [task("O", { status: "running", targetAt: Date.now() + 30_000 })];
    await taskScheduler.handleTaskStatusUpdate("O", "cancelled", { result: "cancelled", clicks: 0, detail: "Cancelled", finishedAt: Date.now() });
    expect(byId("O").status).toBe("cancelled");
  });

  it("a late status for a task deleted meanwhile does not bring it back", async () => {
    localStore[STORAGE_KEYS.SCHEDULED_TASKS] = [task("X", { status: "running", targetAt: Date.now() })];
    await Promise.all([
      taskScheduler.cancelTask("X"),
      taskScheduler.handleTaskStatusUpdate("X", "cancelled"),
    ]);
    expect(tasks().find((t) => t.id === "X")).toBeUndefined();
  });
});

describe("background clock calibration", () => {
  it("never probes a default site: a target URL is required", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(timeCalibrator.calibrate(3, 1000)).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("runs one calibration at a time per site: concurrent callers share it", async () => {
    let second = Math.floor(Date.now() / 1000) * 1000;
    const fetchSpy = vi.fn(async () => {
      second += 1000;
      return new Response(null, { headers: { Date: new Date(second).toUTCString() } });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const url = "https://shop.vn/favicon.ico";
    const [a, b, c] = await Promise.all([
      timeCalibrator.calibrate(3, 3000, url),
      timeCalibrator.calibrate(3, 3000, url),
      timeCalibrator.calibrate(3, 3000, url),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("a failed calibration does not overwrite a good stored one", async () => {
    const good = { offsetMs: 120, rttMs: 40, errorMs: 20, calibrated: true, lastCalibratedAt: Date.now(), serverHost: "shop.vn" };
    localStore[STORAGE_KEYS.CLOCK_CALIBRATION] = good;
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const res = await timeCalibrator.calibrate(3, 2000, "https://shop.vn/favicon.ico");
    expect(res.calibrated).toBe(false);
    expect(localStore[STORAGE_KEYS.CLOCK_CALIBRATION]).toEqual(good);
  });
});

describe("scheduling the same hunt again / editing a hunt", () => {
  it("the same page at the same time updates the waiting hunt instead of adding a copy", async () => {
    const a = task("A", { targetHour: 0, targetMinute: 0, targetSecond: 0, targetAt: undefined, createdAt: Date.now() });
    await taskScheduler.scheduleTask(a);
    await taskScheduler.scheduleTask({ ...a, id: "B", isDaily: true, targetUrl: a.targetUrl + "?utm_source=x" });
    expect(tasks()).toHaveLength(1);
    expect(byId("A").isDaily).toBe(true);
    expect(alarms["dh_task_A"]).toBeDefined();
    expect(alarms["dh_task_B"]).toBeUndefined();

    await taskScheduler.scheduleTask({ ...a, id: "C", targetHour: 12 });
    expect(tasks()).toHaveLength(2);
  });

  it("editing a hunt changes its time, keeps its id and resets its alarm", async () => {
    localStore[STORAGE_KEYS.SCHEDULED_TASKS] = [task("E", { targetAt: Date.now() + HOUR, status: "missed" })];
    const before = byId("E");
    await taskScheduler.updateTask({ ...before, targetHour: (before.targetHour + 2) % 24, dualDefenseReload: false });
    const after = byId("E");
    expect(after.status).toBe("pending");
    expect(after.dualDefenseReload).toBe(false);
    expect(after.targetAt).not.toBe(before.targetAt);
    expect(alarms["dh_task_E"]?.when).toBeLessThanOrEqual(after.targetAt!);
  });
});
