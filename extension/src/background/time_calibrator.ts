import { SHOPEE_URLS } from "../lib/constants";
import { ClockCalibration } from "../lib/types";
import { storage } from "../lib/storage";

/** One HEAD probe: local send/receive times and the server's Date header (1-second resolution). */
export interface ClockProbe {
  sentAt: number;
  receivedAt: number;
  serverSecondMs: number; // Date header value in ms (always a whole second)
}

/**
 * Estimates (serverTime - localTime) from consecutive probes.
 *
 * The HTTP Date header only has 1-second resolution, so a single probe is off by up to 1000ms.
 * Instead we look for the moment the server's second ticks over: between two consecutive probes
 * whose Date differs, the server clock crossed a whole second. Taking each probe's server-side
 * moment as the midpoint of its round trip, the crossing happened between the two midpoints,
 * so the error is about half the gap between them (≈ RTT/2 with back-to-back probes).
 */
export function estimateOffsetFromProbes(probes: ClockProbe[]): { offsetMs: number; errorMs: number } | null {
  const estimates: { offset: number; error: number }[] = [];

  for (let i = 1; i < probes.length; i++) {
    const prev = probes[i - 1];
    const curr = probes[i];
    if (curr.serverSecondMs !== prev.serverSecondMs + 1000) continue;

    const prevMid = (prev.sentAt + prev.receivedAt) / 2;
    const currMid = (curr.sentAt + curr.receivedAt) / 2;
    const boundaryLocal = (prevMid + currMid) / 2;
    estimates.push({ offset: curr.serverSecondMs - boundaryLocal, error: (currMid - prevMid) / 2 });
  }

  if (estimates.length === 0) return null;

  estimates.sort((a, b) => a.offset - b.offset);
  const median = estimates[Math.floor(estimates.length / 2)];
  return { offsetMs: Math.round(median.offset), errorMs: Math.round(median.error) };
}

export class TimeCalibrator {
  private targetUrl: string = SHOPEE_URLS.PING_TARGET;

  private async probe(): Promise<ClockProbe | null> {
    const sentAt = Date.now();
    const res = await fetch(this.targetUrl, { method: "HEAD", cache: "no-store", credentials: "omit" });
    const receivedAt = Date.now();
    const header = res.headers.get("Date");
    const serverSecondMs = header ? new Date(header).getTime() : NaN;
    if (!Number.isFinite(serverSecondMs)) return null;
    return { sentAt, receivedAt, serverSecondMs };
  }

  /**
   * Probes Shopee back-to-back until `boundaries` second roll-overs were observed (or the time budget
   * runs out) and stores the median offset. When no roll-over could be observed the calibration is
   * marked as not calibrated instead of pretending an offset of 0 is accurate.
   */
  async calibrate(boundaries = 3, budgetMs = 6000): Promise<ClockCalibration> {
    const probes: ClockProbe[] = [];
    const deadline = Date.now() + budgetMs;
    let seen = 0;

    while (Date.now() < deadline && seen < boundaries) {
      try {
        const p = await this.probe();
        if (p) {
          const last = probes[probes.length - 1];
          if (last && p.serverSecondMs === last.serverSecondMs + 1000) seen++;
          probes.push(p);
        }
      } catch (err) {
        console.warn("[TimeCalibrator] Probe failed:", err);
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    const rtts = probes.map((p) => p.receivedAt - p.sentAt).sort((a, b) => a - b);
    const medianRtt = rtts.length ? rtts[Math.floor(rtts.length / 2)] : 0;
    const estimate = estimateOffsetFromProbes(probes);

    const calibration: ClockCalibration = estimate
      ? {
          offsetMs: estimate.offsetMs,
          rttMs: medianRtt,
          errorMs: estimate.errorMs,
          calibrated: true,
          lastCalibratedAt: Date.now(),
        }
      : { offsetMs: 0, rttMs: medianRtt, errorMs: 1000, calibrated: false, lastCalibratedAt: Date.now() };

    await storage.saveCalibration(calibration);
    return calibration;
  }
}

export const timeCalibrator = new TimeCalibrator();
