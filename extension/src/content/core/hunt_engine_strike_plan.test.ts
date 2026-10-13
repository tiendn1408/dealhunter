import { describe, it, expect, beforeEach, vi } from "vitest";

// A platform adapter with its own strike schedule (like Caffiliate): the engine must start the
// direct strike planStrike().leadMs before the drop, even when that is earlier than leadMs (150).
const strikeAt: number[] = [];
let clock = 0;
const fakeAdapter = {
  platformName: "fake",
  maxClicks: 1,
  windowMs: 3000,
  isMatchUrl: () => true,
  findVoucherButtons: () => [],
  isButtonFinished: () => false,
  shouldDisableReload: () => true,
  preWarmStrike: vi.fn(),
  planStrike: vi.fn(() => ({ leadMs: 900 })),
  executeDirectStrike: vi.fn(() => {
    strikeAt.push(clock);
    return true;
  }),
};
vi.mock("../adapters", () => ({ getAdapterForUrl: () => fakeAdapter }));

const { startHunt } = await import("./hunt_engine");

const DROP = 1_800_000_000_000;

describe("startHunt with a platform strike plan", () => {
  beforeEach(() => {
    strikeAt.length = 0;
    sessionStorage.clear();
    HTMLElement.prototype.getBoundingClientRect = () =>
      ({ left: 10, top: 10, width: 80, height: 30, right: 90, bottom: 40, x: 10, y: 10, toJSON() {} }) as DOMRect;
    HTMLElement.prototype.scrollIntoView = () => {};
    document.body.innerHTML = `<button id="btnCheckIn" disabled>Điểm danh</button>`;
  });

  it("strikes once at T - leadMs from the plan, re-planned after the pre-drop hook", () => {
    clock = DROP - 5000;
    let cb: (() => void) | null = null;
    const ticker = { start: (_: number, f: () => void) => (cb = f), stop: () => (cb = null) };
    startHunt({
      targetTimestamp: DROP,
      now: () => clock,
      locked: document.getElementById("btnCheckIn"),
      ticker,
      platformTier: "speed_priority",
      onDone: () => {},
    });

    while (clock < DROP + 500 && cb) {
      clock += 5;
      (cb as () => void)();
    }

    expect(fakeAdapter.preWarmStrike).toHaveBeenCalled();
    expect(fakeAdapter.planStrike.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(strikeAt).toHaveLength(1);
    expect(DROP - strikeAt[0]).toBeGreaterThanOrEqual(895);
    expect(DROP - strikeAt[0]).toBeLessThanOrEqual(900);
  });
});
