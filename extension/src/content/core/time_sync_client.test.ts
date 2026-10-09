import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { TimeSyncClient } from "./time_sync_client";
import { ClockCalibration } from "../../lib/types";

describe("TimeSyncClient", () => {
  let client: TimeSyncClient;

  beforeEach(() => {
    client = new TimeSyncClient();
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(),
      },
      storage: {
        onChanged: {
          addListener: vi.fn(),
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("extracts normalized current domain without www", () => {
    expect(client.getCurrentDomain()).toBe(window.location.hostname.replace(/^www\./, "").toLowerCase());
  });

  it("applies calibration correctly and notifies subscribers", () => {
    const cal: ClockCalibration = {
      offsetMs: 150,
      rttMs: 25,
      errorMs: 12,
      lastCalibratedAt: Date.now(),
      calibrated: true,
      serverHost: "example.com",
    };

    const received: ClockCalibration[] = [];
    const unsubscribe = client.onCalibrationChange((c) => received.push(c));

    client.applyCalibration(cal);

    expect(client.getOffset()).toBe(150);
    expect(client.getErrorMs()).toBe(12);
    expect(client.getIsCalibrated()).toBe(true);
    expect(client.getServerHost()).toBe("example.com");
    expect(received.length).toBe(1);
    expect(received[0].offsetMs).toBe(150);

    unsubscribe();
    client.applyCalibration({ ...cal, offsetMs: 200 });
    expect(received.length).toBe(1);
  });

  it("calculates server time as Date.now() + offsetMs", () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    client.applyCalibration({
      offsetMs: -250,
      rttMs: 25,
      errorMs: 15,
      lastCalibratedAt: now,
      calibrated: true,
      serverHost: "example.com",
    });

    expect(client.getServerTime()).toBe(now - 250);
    expect(client.getShopeeTime()).toBe(now - 250);
  });

  it("init applies fresh matching calibration from background", async () => {
    const domain = client.getCurrentDomain();
    const freshCal: ClockCalibration = {
      offsetMs: 80,
      rttMs: 25,
      errorMs: 10,
      lastCalibratedAt: Date.now() - 10_000, // 10s ago, fresh
      calibrated: true,
      serverHost: domain,
    };

    (chrome.runtime.sendMessage as any).mockResolvedValue({
      calibration: freshCal,
    });

    await client.init();

    expect(client.getOffset()).toBe(80);
    expect(client.getIsCalibrated()).toBe(true);
  });

  it("init triggers calibrate() if calibration is missing, stale, or mismatched", async () => {
    const domain = client.getCurrentDomain();
    (chrome.runtime.sendMessage as any)
      .mockResolvedValueOnce({ calibration: null }) // GET_CALIBRATION
      .mockResolvedValueOnce({ // CALIBRATE_TIME
        calibration: {
          offsetMs: 120,
          rttMs: 25,
          errorMs: 8,
          lastCalibratedAt: Date.now(),
          calibrated: true,
          serverHost: domain,
        },
      });

    await client.init();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    expect(client.getOffset()).toBe(120);
    expect(client.getIsCalibrated()).toBe(true);
  });

  it("calibrate sends CALIBRATE_TIME with samples: 3", async () => {
    const domain = client.getCurrentDomain();
    (chrome.runtime.sendMessage as any).mockResolvedValue({
      calibration: {
        offsetMs: 95,
        rttMs: 25,
        errorMs: 15,
        lastCalibratedAt: Date.now(),
        calibrated: true,
        serverHost: domain,
      },
    });

    const res = await client.calibrate();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      action: "CALIBRATE_TIME",
      samples: 3,
    }));
    expect(res?.offsetMs).toBe(95);
    expect(client.getOffset()).toBe(95);
  });
});
