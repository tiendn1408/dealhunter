import { describe, it, expect, beforeEach, vi } from "vitest";
import { computePreReloadLeadMs, pageKey, reloadTiming, RELOAD_TIMING } from "./reload_timing";

describe("computePreReloadLeadMs", () => {
  it("falls back to 750ms when the page was never measured", () => {
    expect(computePreReloadLeadMs([])).toBe(RELOAD_TIMING.DEFAULT_LEAD_MS);
  });

  it("is the median load time plus a spread margin and a safety margin", () => {
    // median 1000, quartiles 950..1050 -> spread 100/1.349 = 74 -> 1000 + 1.5*74 + 150 = 1261
    expect(computePreReloadLeadMs([900, 950, 1000, 1050, 1100])).toBe(1261);
  });

  it("a page that loads unevenly gets a wider margin than a steady one", () => {
    const steady = computePreReloadLeadMs([1000, 1010, 990, 1005, 995]);
    const uneven = computePreReloadLeadMs([600, 800, 1000, 1400, 1800]);
    expect(uneven).toBeGreaterThan(steady);
  });

  it("stays within [400ms, 6s]", () => {
    expect(computePreReloadLeadMs([50, 60, 55, 52])).toBe(RELOAD_TIMING.MIN_LEAD_MS);
    expect(computePreReloadLeadMs([9000, 9500, 9800, 9900])).toBe(RELOAD_TIMING.MAX_LEAD_MS);
  });
});

describe("reloadTiming store", () => {
  let store: Record<string, any>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: store[key] })),
          set: vi.fn(async (items: Record<string, any>) => Object.assign(store, items)),
        },
      },
    });
  });

  it("keys samples per page, ignoring query and hash", () => {
    expect(pageKey("https://shop.vn/flash?id=1#top")).toBe("https://shop.vn/flash");
  });

  it("records load times, keeps the newest 10, and updates the lead used when arming", async () => {
    const url = "https://shop.vn/flash-sale";
    expect(reloadTiming.leadFor(url)).toBe(RELOAD_TIMING.DEFAULT_LEAD_MS);
    for (let i = 0; i < 12; i++) await reloadTiming.record(url, 1000 + i);

    const saved = store.dh_page_load_samples[pageKey(url)];
    expect(saved.samplesMs).toHaveLength(RELOAD_TIMING.MAX_SAMPLES);
    expect(saved.samplesMs[0]).toBe(1011);
    expect(reloadTiming.leadFor(url)).toBe(computePreReloadLeadMs(saved.samplesMs));
    expect(reloadTiming.leadFor(url + "?ref=x")).toBe(reloadTiming.leadFor(url));
  });

  it("ignores impossible or outlier load times", async () => {
    await reloadTiming.record("https://a.vn/x", 0);
    await reloadTiming.record("https://a.vn/x", 60_000);
    expect(store.dh_page_load_samples).toBeUndefined();
  });

  it("forgets pages not visited for 30 days", async () => {
    store.dh_page_load_samples = {
      "https://old.vn/p": { samplesMs: [900], updatedAt: Date.now() - RELOAD_TIMING.TTL_MS - 1 },
    };
    await reloadTiming.record("https://new.vn/p", 800);
    expect(Object.keys(store.dh_page_load_samples)).toEqual(["https://new.vn/p"]);
  });

  it("load() fills the cache from storage", async () => {
    store.dh_page_load_samples = {
      "https://b.vn/deal": { samplesMs: [2000, 2100, 1900, 2050], updatedAt: Date.now() },
    };
    const lead = await reloadTiming.load("https://b.vn/deal?x=1");
    expect(lead).toBe(computePreReloadLeadMs([2000, 2100, 1900, 2050]));
    expect(reloadTiming.leadFor("https://b.vn/deal")).toBe(lead);
  });
});
