import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The precise clock calibration is scheduled ~30 s before the drop, only for a platform that plans
// its own strike (Caffiliate), and never left running after the hunt is gone.
let adapter: Record<string, unknown> | null = null;
vi.mock("../adapters", () => ({ getAdapterForUrl: () => adapter }));
vi.mock("./hunt_engine", () => ({
  startHunt: () => () => {},
  HUNT_DEFAULTS: { speedPriorityWindowMs: 2000, windowMs: 8000, speedPriorityMaxClicks: 6 },
}));

const { HuntCoordinator } = await import("./hunt_coordinator");
const { timeSyncClient } = await import("./time_sync_client");
const { PRECISE_CALIBRATION_LEAD_MS } = await import("../../lib/constants");

const NOW = 1_800_000_000_000;

describe("precise clock calibration before a planned strike", () => {
  let precise: ReturnType<typeof vi.fn>;
  let btn: HTMLButtonElement;

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    btn = document.createElement("button");
    btn.textContent = "Điểm danh";
    document.body.appendChild(btn);
    vi.spyOn(timeSyncClient, "getServerTime").mockReturnValue(NOW);
    precise = vi.fn().mockResolvedValue(null);
    vi.spyOn(timeSyncClient, "calibratePrecise").mockImplementation(precise as any);
    vi.stubGlobal("chrome", {
      runtime: { id: "x", sendMessage: vi.fn().mockResolvedValue({ success: true }) },
      storage: { local: { get: async () => ({}), set: async () => {} } },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  const caffiliate = { platformName: "caffiliate", planStrike: () => ({ leadMs: 1500 }), shouldDisableReload: () => true };

  it("runs once, PRECISE_CALIBRATION_LEAD_MS before the drop, for a strike-planning platform", () => {
    adapter = caffiliate;
    new HuntCoordinator().arm({ targetTimestamp: NOW + 55_000, targetElement: btn });
    vi.advanceTimersByTime(55_000 - PRECISE_CALIBRATION_LEAD_MS - 1);
    expect(precise).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(precise).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(precise).toHaveBeenCalledTimes(1);
  });

  it("is not scheduled for marketplaces that do not plan their strike (no extra probes near the drop)", () => {
    adapter = { platformName: "shopee", shouldDisableReload: () => false };
    new HuntCoordinator().arm({ targetTimestamp: NOW + 55_000, targetElement: btn });
    vi.advanceTimersByTime(120_000);
    expect(precise).not.toHaveBeenCalled();
  });

  it("armed late (20 s before): runs at once; too late (8 s before, would end after the plan): skipped", () => {
    adapter = caffiliate;
    new HuntCoordinator().arm({ targetTimestamp: NOW + 20_000, targetElement: btn });
    expect(precise).toHaveBeenCalledTimes(1);
    precise.mockClear();
    new HuntCoordinator().arm({ targetTimestamp: NOW + 8_000, targetElement: btn });
    vi.advanceTimersByTime(20_000);
    expect(precise).not.toHaveBeenCalled();
  });

  it("disarming before the time cancels it", () => {
    adapter = caffiliate;
    const c = new HuntCoordinator();
    c.arm({ targetTimestamp: NOW + 55_000, targetElement: btn });
    c.disarm(false);
    vi.advanceTimersByTime(120_000);
    expect(precise).not.toHaveBeenCalled();
  });

  it("re-arming (e.g. after the 23:59:00 reload) keeps a single scheduled run", () => {
    adapter = caffiliate;
    const c = new HuntCoordinator();
    c.arm({ targetTimestamp: NOW + 55_000, targetElement: btn });
    c.arm({ targetTimestamp: NOW + 55_000, targetElement: btn });
    vi.advanceTimersByTime(120_000);
    expect(precise).toHaveBeenCalledTimes(1);
  });
});
