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

  it("retrieves saved target ignoring hash or query parameters", async () => {
    await storage.savePageTarget(sampleTarget);
    const found = await storage.getSavedTargetForUrl("https://app.caffiliate.vn/mission?tab=daily#section");
    expect(found).not.toBeNull();
    expect(found?.id).toBe("target-caffiliate-1");
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
