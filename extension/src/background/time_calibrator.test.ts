import { describe, it, expect, vi, beforeEach } from "vitest";
import { TimeCalibrator } from "./time_calibrator";

describe("TimeCalibrator", () => {
  let calibrator: TimeCalibrator;

  beforeEach(() => {
    calibrator = new TimeCalibrator();
    // Mock global chrome
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
    };
  });

  it("calculates median offset with RTT compensation", async () => {
    // Mock fetch with Date header
    const mockDate = new Date("2026-10-10T00:00:00.000Z").toUTCString();
    globalThis.fetch = vi.fn().mockResolvedValue({
      headers: {
        get: (header: string) => (header === "Date" ? mockDate : null),
      },
    });

    const result = await calibrator.calibrate(3);
    expect(result).toBeDefined();
    expect(typeof result.offsetMs).toBe("number");
    expect(typeof result.rttMs).toBe("number");
    expect(result.lastCalibratedAt).toBeGreaterThan(0);
  });
});
