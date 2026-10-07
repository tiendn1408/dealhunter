import { describe, it, expect, vi, beforeEach } from "vitest";
import { TimeCalibrator, estimateOffsetFromProbes, ClockProbe } from "./time_calibrator";

/** Simulates back-to-back HEAD probes against a server whose clock is `trueOffset` ms ahead. */
function simulateProbes(trueOffset: number, rtt: number, count: number, startLocal = 1_000_000_123): ClockProbe[] {
  const probes: ClockProbe[] = [];
  let t = startLocal;
  for (let i = 0; i < count; i++) {
    const sentAt = t;
    const serverMoment = sentAt + rtt / 2 + trueOffset; // server stamps the response mid-flight
    const receivedAt = sentAt + rtt;
    probes.push({ sentAt, receivedAt, serverSecondMs: Math.floor(serverMoment / 1000) * 1000 });
    t = receivedAt + 2;
  }
  return probes;
}

describe("estimateOffsetFromProbes", () => {
  it.each([
    [366, 40],
    [-1450, 60],
    [12, 25],
    [999, 80],
  ])("recovers a %ims server offset within ~RTT/2 (rtt %ims)", (trueOffset, rtt) => {
    const est = estimateOffsetFromProbes(simulateProbes(trueOffset, rtt, 120));
    expect(est).not.toBeNull();
    expect(Math.abs(est!.offsetMs - trueOffset)).toBeLessThanOrEqual(rtt / 2 + 2);
  });

  it("returns null when the server second never rolls over (no fake 0 offset)", () => {
    const probes = simulateProbes(0, 40, 5, 1_000_000_000); // 5 probes stay inside one second
    expect(estimateOffsetFromProbes(probes)).toBeNull();
  });
});

describe("TimeCalibrator.calibrate", () => {
  beforeEach(() => {
    (globalThis as any).chrome = {
      storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } },
    };
  });

  it("marks the calibration as not calibrated when no roll-over is observed", async () => {
    const frozen = new Date("2026-10-10T00:00:00.000Z").toUTCString();
    globalThis.fetch = vi.fn().mockResolvedValue({ headers: { get: (h: string) => (h === "Date" ? frozen : null) } });

    const result = await new TimeCalibrator().calibrate(3, 200);
    expect(result.calibrated).toBe(false);
    expect(result.offsetMs).toBe(0);
    expect(result.errorMs).toBe(1000);
  });
});
