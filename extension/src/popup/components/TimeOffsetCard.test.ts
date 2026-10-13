import { describe, it, expect, vi, beforeEach } from "vitest";
import { shouldAutoSync, isHuntedPage } from "./TimeOffsetCard";

// The popup measures the clock by itself only on a page that is hunted (decision 2).

let store: Record<string, unknown>;
beforeEach(() => {
  store = {};
  vi.stubGlobal("chrome", {
    storage: { local: { get: async (k: string) => ({ [k]: store[k] }) } },
  });
});

describe("clock card", () => {
  it("re-measures only when never measured, failed, or older than 5 minutes", () => {
    const now = 10_000_000;
    const cal = { offsetMs: 10, rttMs: 30, errorMs: 15, calibrated: true, lastCalibratedAt: now - 60_000, serverHost: "shopee.vn" };
    expect(shouldAutoSync(null, now)).toBe(true);
    expect(shouldAutoSync({ ...cal, calibrated: false }, now)).toBe(true);
    expect(shouldAutoSync(cal, now)).toBe(false);
    expect(shouldAutoSync({ ...cal, lastCalibratedAt: now - 6 * 60_000 }, now)).toBe(true);
  });

  it("a page is hunted when it has a saved button or an unfinished task", async () => {
    expect(await isHuntedPage("https://claude.ai/new")).toBe(false);

    store.dh_saved_page_targets = [{ id: "t", url: "https://shopee.vn/m/ma-giam-gia", name: "Lưu", descriptor: {} }];
    expect(await isHuntedPage("https://shopee.vn/m/ma-giam-gia")).toBe(true);

    store.dh_scheduled_tasks = [
      { id: "a", targetUrl: "https://tiki.vn/khuyen-mai", status: "completed" },
      { id: "b", targetUrl: "https://lazada.vn/voucher", status: "pending" },
    ];
    expect(await isHuntedPage("https://tiki.vn/khuyen-mai")).toBe(false);
    expect(await isHuntedPage("https://lazada.vn/voucher")).toBe(true);
  });
});

describe("3-step guide", () => {
  it("shows to a new user, goes away once a button is picked, and comes back only on request", async () => {
    const { shouldShowGuide } = await import("./HomePanel");
    expect(shouldShowGuide(undefined, false)).toBe(true); // brand new
    expect(shouldShowGuide(undefined, true)).toBe(false); // already picked a button / scheduled
    expect(shouldShowGuide(true, false)).toBe(false); // dismissed
    expect(shouldShowGuide("again", true)).toBe(true); // "show the guide again" in settings
  });
});
