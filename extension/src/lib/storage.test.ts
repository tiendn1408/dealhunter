import { describe, it, expect, beforeEach, vi } from "vitest";
import { storage } from "./storage";
import { SavedPageTarget } from "./types";

let localStore: Record<string, unknown>;

beforeEach(() => {
  localStore = {};
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: localStore[key] }),
        set: async (items: Record<string, unknown>) => Object.assign(localStore, items),
        remove: async (key: string) => void delete localStore[key],
      },
    },
  });
});

describe("storage saved page targets", () => {
  const sampleTarget: SavedPageTarget = {
    id: "target-caffiliate-1",
    url: "https://app.caffiliate.vn/mission",
    origin: "https://app.caffiliate.vn",
    name: "DIEM DANH (+1)",
    targetSlot: "midnight",
    descriptor: {
      id: "btn-checkin",
      uniqueSelector: "button#btn-checkin",
      tagName: "BUTTON",
      attributes: { class: "btn-gold uppercase font-bold" },
      initialText: "DIEM DANH (+1)",
    },
    updatedAt: Date.now(),
  };

  it("returns empty list if nothing saved", async () => {
    const list = await storage.getSavedPageTargets();
    expect(list).toEqual([]);
    const found = await storage.getSavedTargetForUrl("https://app.caffiliate.vn/mission");
    expect(found).toBeNull();
  });

  it("saves a new page target and retrieves it by exact URL", async () => {
    await storage.savePageTarget(sampleTarget);
    const found = await storage.getSavedTargetForUrl("https://app.caffiliate.vn/mission");
    expect(found).not.toBeNull();
    expect(found?.name).toBe("DIEM DANH (+1)");
    expect(found?.targetSlot).toBe("midnight");
  });

  it("retrieves saved target with marketing tags stripped but distinguishes different functional query parameters", async () => {
    await storage.savePageTarget(sampleTarget);
    const withTracking = await storage.getSavedTargetForUrl("https://app.caffiliate.vn/mission?utm_source=facebook&fbclid=abc");
    expect(withTracking).not.toBeNull();
    expect(withTracking?.id).toBe("target-caffiliate-1");

    const differentTab = await storage.getSavedTargetForUrl("https://app.caffiliate.vn/mission?tab=daily");
    expect(differentTab).toBeNull();
  });

  it("updates existing page target when id or url matches", async () => {
    await storage.savePageTarget(sampleTarget);
    const updated: SavedPageTarget = {
      ...sampleTarget,
      name: "DIEM DANH VIP",
      targetSlot: "custom",
      customTime: "20:29:00",
    };
    await storage.savePageTarget(updated);

    const all = await storage.getSavedPageTargets();
    expect(all.length).toBe(1);
    expect(all[0].name).toBe("DIEM DANH VIP");
    expect(all[0].customTime).toBe("20:29:00");
  });

  it("removes a saved page target by id", async () => {
    await storage.savePageTarget(sampleTarget);
    await storage.removePageTarget("target-caffiliate-1");

    const found = await storage.getSavedTargetForUrl("https://app.caffiliate.vn/mission");
    expect(found).toBeNull();
  });
});

describe("storage per-domain calibration", () => {
  it("saves and retrieves calibrations per domain independently", async () => {
    await storage.saveCalibration({
      offsetMs: 150,
      rttMs: 30,
      errorMs: 10,
      calibrated: true,
      lastCalibratedAt: Date.now(),
      serverHost: "shopee.vn",
    });

    await storage.saveCalibration({
      offsetMs: -220,
      rttMs: 25,
      errorMs: 12,
      calibrated: true,
      lastCalibratedAt: Date.now(),
      serverHost: "app.caffiliate.vn",
    });

    const shopeeCal = await storage.getCalibration("shopee.vn");
    expect(shopeeCal).not.toBeNull();
    expect(shopeeCal?.offsetMs).toBe(150);
    expect(shopeeCal?.serverHost).toBe("shopee.vn");

    const caffiliateCal = await storage.getCalibration("app.caffiliate.vn");
    expect(caffiliateCal).not.toBeNull();
    expect(caffiliateCal?.offsetMs).toBe(-220);
    expect(caffiliateCal?.serverHost).toBe("app.caffiliate.vn");

    // Uncalibrated domain returns null
    const unknownCal = await storage.getCalibration("lazada.vn");
    expect(unknownCal).toBeNull();
  });
});


describe("storage.saveSettings", () => {
  it("concurrent writes of different keys keep both (no lost update)", async () => {
    const tick = () => new Promise((r) => setTimeout(r, 0));
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: async (key: string) => (await tick(), { [key]: structuredClone(localStore[key]) }),
          set: async (items: Record<string, unknown>) => (await tick(), void Object.assign(localStore, items)),
        },
      },
    });
    await Promise.all([storage.setLanguage("vi"), storage.saveSettings({ soundEnabled: false })]);
    const settings = await storage.getSettings();
    expect(settings.language).toBe("vi");
    expect(settings.soundEnabled).toBe(false);
  });
});

describe("M1: storage concurrent task operations", () => {
  it("concurrent task writes preserve all tasks without lost updates", async () => {
    const tick = () => new Promise((r) => setTimeout(r, 0));
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: async (key: string) => (await tick(), { [key]: structuredClone(localStore[key]) }),
          set: async (items: Record<string, unknown>) => (await tick(), void Object.assign(localStore, items)),
        },
      },
    });

    const task1 = {
      id: "task-1",
      targetHour: 12,
      targetMinute: 0,
      targetUrl: "https://shopee.vn",
      label: "Task 1",
      mode: "full_auto" as const,
      status: "pending" as const,
      createdAt: Date.now(),
    };
    const task2 = {
      id: "task-2",
      targetHour: 12,
      targetMinute: 0,
      targetUrl: "https://shopee.vn",
      label: "Task 2",
      mode: "full_auto" as const,
      status: "pending" as const,
      createdAt: Date.now(),
    };

    await Promise.all([storage.addTask(task1), storage.addTask(task2)]);

    const tasks = await storage.getTasks();
    expect(tasks.length).toBe(2);
    expect(tasks.map((t) => t.id).sort()).toEqual(["task-1", "task-2"]);
  });
});

describe("P2 and L11: storage calibration cleanup and race condition prevention", () => {
  it("P2: purges expired domain calibrations (>24h) when saving new calibrations", async () => {
    const now = Date.now();
    const TTL_MS = 24 * 60 * 60 * 1000;

    // Seed storage with an expired calibration (25 hours ago) and a recent one
    localStore["dh_domain_calibrations"] = {
      "old-domain.com": {
        offsetMs: 10,
        rttMs: 20,
        errorMs: 5,
        calibrated: true,
        lastCalibratedAt: now - TTL_MS - 3600000,
        serverHost: "old-domain.com",
      },
      "recent-domain.com": {
        offsetMs: 15,
        rttMs: 25,
        errorMs: 5,
        calibrated: true,
        lastCalibratedAt: now - 3600000,
        serverHost: "recent-domain.com",
      },
    };

    // Save a new calibration for another domain
    await storage.saveCalibration({
      offsetMs: 50,
      rttMs: 30,
      errorMs: 8,
      calibrated: true,
      lastCalibratedAt: now,
      serverHost: "new-domain.com",
    });

    const dict = localStore["dh_domain_calibrations"] as Record<string, any>;
    expect(dict).toBeDefined();
    // old-domain.com should be purged
    expect(dict["old-domain.com"]).toBeUndefined();
    // recent-domain.com should still exist
    expect(dict["recent-domain.com"]).toBeDefined();
    // new-domain.com should exist
    expect(dict["new-domain.com"]).toBeDefined();
  });

  it("L11: concurrent calibration saves for different domains preserve both", async () => {
    const tick = () => new Promise((r) => setTimeout(r, 0));
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: async (key: string) => (await tick(), { [key]: structuredClone(localStore[key]) }),
          set: async (items: Record<string, unknown>) => (await tick(), void Object.assign(localStore, items)),
        },
      },
    });

    await Promise.all([
      storage.saveCalibration({
        offsetMs: 100,
        rttMs: 20,
        errorMs: 5,
        calibrated: true,
        lastCalibratedAt: Date.now(),
        serverHost: "shopee.vn",
      }),
      storage.saveCalibration({
        offsetMs: 200,
        rttMs: 25,
        errorMs: 6,
        calibrated: true,
        lastCalibratedAt: Date.now(),
        serverHost: "lazada.vn",
      }),
    ]);

    const dict = localStore["dh_domain_calibrations"] as Record<string, any>;
    expect(dict).toBeDefined();
    expect(dict["shopee.vn"]).toBeDefined();
    expect(dict["lazada.vn"]).toBeDefined();
  });
});

