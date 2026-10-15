import { describe, it, expect, beforeEach, vi } from "vitest";

// A platform whose strike goes through the page itself (like Caffiliate's app.checkIn()) must fire
// on time even when the check-in button cannot be found at the drop.
const strikeAt: number[] = [];
let clock = 0;
let confirmed = false;
const fakeAdapter = {
  platformName: "fake",
  maxClicks: 1,
  windowMs: 3000,
  isMatchUrl: () => true,
  findVoucherButtons: () => [],
  isButtonFinished: () => confirmed,
  confirmsCompletion: () => confirmed,
  shouldDisableReload: () => true,
  planStrike: () => ({ leadMs: 900 }),
  strikesWithoutTarget: () => true,
  executeDirectStrike: vi.fn(() => {
    strikeAt.push(clock);
    return true;
  }),
};
vi.mock("../adapters", () => ({ getAdapterForUrl: () => fakeAdapter }));

const { startHunt } = await import("./hunt_engine");

const DROP = 1_800_000_000_000;

function run(locked: HTMLElement | null, confirmAt?: number) {
  clock = DROP - 5000;
  let cb: (() => void) | null = null;
  const ticker = { start: (_: number, f: () => void) => (cb = f), stop: () => (cb = null) };
  const outcomes: { result: string; clicks: number }[] = [];
  startHunt({
    targetTimestamp: DROP,
    now: () => clock,
    locked,
    universalDescriptor: locked ? undefined : ({ initialText: "Điểm danh" } as never),
    ticker,
    platformTier: "speed_priority",
    onDone: (o) => outcomes.push(o),
  });
  while (clock < DROP + 4000 && cb) {
    clock += 5;
    if (confirmAt !== undefined && clock >= confirmAt) confirmed = true;
    (cb as () => void)();
  }
  return outcomes;
}

describe("startHunt when the platform strikes without the button", () => {
  beforeEach(() => {
    strikeAt.length = 0;
    confirmed = false;
    fakeAdapter.executeDirectStrike.mockClear();
    sessionStorage.clear();
    HTMLElement.prototype.getBoundingClientRect = () =>
      ({ left: 10, top: 10, width: 80, height: 30, right: 90, bottom: 40, x: 10, y: 10, toJSON() {} }) as DOMRect;
    HTMLElement.prototype.scrollIntoView = () => {};
  });

  it("strikes on time when the button is nowhere on the page", () => {
    document.body.innerHTML = `<p>no button here</p>`;
    const outcomes = run(null);
    expect(strikeAt).toHaveLength(1);
    expect(DROP - strikeAt[0]).toBeGreaterThanOrEqual(895);
    expect(DROP - strikeAt[0]).toBeLessThanOrEqual(900);
    // Struck but never confirmed: a timeout, not "button not found"
    expect(outcomes[0]?.result).toBe("timeout");
    expect(outcomes[0]?.clicks).toBe(1);
  });

  it("strikes on time when the button still shows yesterday's result", () => {
    document.body.innerHTML = `<button id="btnCheckIn" disabled>Đã điểm danh #12</button>`;
    run(document.getElementById("btnCheckIn"));
    expect(strikeAt).toHaveLength(1);
    expect(DROP - strikeAt[0]).toBeLessThanOrEqual(900);
  });

  it("finishes as saved once the site confirms, even without a button", () => {
    document.body.innerHTML = `<p>no button here</p>`;
    const outcomes = run(null, DROP + 200);
    expect(outcomes[0]?.result).toBe("saved");
    expect(fakeAdapter.executeDirectStrike).toHaveBeenCalledTimes(1);
  });
});
