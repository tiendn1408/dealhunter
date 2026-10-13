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

    const result = await new TimeCalibrator().calibrate(3, 200, "https://shop.vn/favicon.ico");
    expect(result.calibrated).toBe(false);
    expect(result.offsetMs).toBe(0);
    expect(result.errorMs).toBe(1000);
  });
});

describe("a site whose favicon comes from a CDN cache", () => {
  beforeEach(() => {
    (globalThis as any).chrome = {
      storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } },
    };
  });

  it("is measured with its home page when the favicon's time is days old", async () => {
    const stale = new Date("2026-10-07T05:25:47Z").toUTCString(); // cached copy
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string) => {
      urls.push(url);
      const date = url.endsWith("/favicon.ico") ? stale : new Date().toUTCString();
      return { headers: { get: (h: string) => (h === "Date" ? date : null) } };
    }) as any;

    const result = await new TimeCalibrator().calibrate(1, 3000, "https://www.google.com/favicon.ico");
    expect(urls[0]).toBe("https://www.google.com/favicon.ico");
    expect(urls.some((u) => u === "https://www.google.com/")).toBe(true);
    expect(urls.every((u) => u.startsWith("https://www.google.com/"))).toBe(true); // never another site
    expect(result.calibrated).toBe(true);
  }, 10_000);

  it("recognises a frozen or far-off server time", async () => {
    const { isStaleServerTime } = await import("./time_calibrator");
    const now = Date.now();
    const sec = Math.floor(now / 1000) * 1000;
    expect(isStaleServerTime([], { sentAt: now, receivedAt: now, serverSecondMs: sec - 4 * 86400e3 })).toBe(true);
    const first = { sentAt: now, receivedAt: now, serverSecondMs: sec };
    expect(isStaleServerTime([first], { sentAt: now + 2500, receivedAt: now + 2500, serverSecondMs: sec })).toBe(true);
    expect(isStaleServerTime([first], { sentAt: now + 900, receivedAt: now + 900, serverSecondMs: sec })).toBe(false);
  });
});
