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

describe("precise calibration: probes aimed at second boundaries", () => {
  it("narrowBracket halves the bracket around the true offset, whichever side the probe lands", async () => {
    const { narrowBracket } = await import("./time_calibrator");
    const trueOffset = 437;
    let b = { lo: 437 - 80, hi: 437 + 80 }; // the rough measurement: ±80 ms
    for (let r = 0; r < 6; r++) {
      const center = (b.lo + b.hi) / 2;
      const boundary = 2_000_000_000_000 + r * 1000;
      const mid = boundary - center; // probe midpoint aimed at the boundary
      const probe = { sentAt: mid - 20, receivedAt: mid + 20, serverSecondMs: Math.floor((mid + trueOffset) / 1000) * 1000 };
      b = narrowBracket(b, probe, boundary);
      expect(b.lo).toBeLessThanOrEqual(trueOffset);
      expect(b.hi).toBeGreaterThanOrEqual(trueOffset);
    }
    expect(b.hi - b.lo).toBeLessThanOrEqual(160 / 2 ** 6 + 1);
  });

  it("finds the server offset within a few ms (was ~RTT/2 + pacing)", async () => {
    (globalThis as any).chrome = {
      storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } },
    };
    const trueOffset = 437;
    const oneWay = 15;
    globalThis.fetch = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, oneWay));
      const server = Date.now() + trueOffset; // the server stamps the response half-way
      await new Promise((r) => setTimeout(r, oneWay));
      return { headers: { get: (h: string) => (h === "Date" ? new Date(Math.floor(server / 1000) * 1000).toUTCString() : null) } };
    }) as any;

    const rough = await new TimeCalibrator().calibrate(3, 6000, "https://caffiliate.vn/favicon.ico");
    const precise = await new TimeCalibrator().calibrate(3, 6000 + 6 * 1200, "https://caffiliate.vn/favicon.ico", 6);
    expect(precise.calibrated).toBe(true);
    expect(Math.abs(precise.offsetMs - trueOffset)).toBeLessThanOrEqual(8);
    expect(precise.errorMs).toBeLessThan(rough.errorMs);
    expect(precise.errorMs).toBeLessThanOrEqual(15);
  }, 30_000);
});

describe("precise calibration never makes things worse", () => {
  beforeEach(() => {
    (globalThis as any).chrome = {
      storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } },
    };
  });

  function server(trueOffset: () => number, oneWay = 15, fail: () => boolean = () => false) {
    globalThis.fetch = vi.fn(async () => {
      if (fail()) throw new Error("network down");
      await new Promise((r) => setTimeout(r, oneWay));
      const at = Date.now() + trueOffset();
      await new Promise((r) => setTimeout(r, oneWay));
      return { headers: { get: (h: string) => (h === "Date" ? new Date(Math.floor(at / 1000) * 1000).toUTCString() : null) } };
    }) as any;
  }

  it("a server clock that jumps 3 s during the refine is ignored: the rough measurement is kept", async () => {
    const start = Date.now();
    server(() => (Date.now() - start > 4000 ? 437 + 3000 : 437));
    const cal = await new TimeCalibrator().calibrate(3, 13_200, "https://caffiliate.vn/favicon.ico", 6);
    expect(cal.calibrated).toBe(true);
    expect(Math.abs(cal.offsetMs - 437)).toBeLessThanOrEqual(80); // the rough one, not 3437
    expect(cal.errorMs).toBeGreaterThan(10); // and its honest error, no false precision
  }, 30_000);

  it("probes failing during the refine keep the rough measurement and its error", async () => {
    const start = Date.now();
    server(() => 437, 15, () => Date.now() - start > 4000);
    const cal = await new TimeCalibrator().calibrate(3, 13_200, "https://caffiliate.vn/favicon.ico", 6);
    expect(cal.calibrated).toBe(true);
    expect(Math.abs(cal.offsetMs - 437)).toBeLessThanOrEqual(80);
    expect(cal.errorMs).toBeGreaterThan(10); // no fake precision when nothing was refined
  }, 30_000);
});
