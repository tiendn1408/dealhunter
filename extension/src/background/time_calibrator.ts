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

/** Time a stale cached response cannot have: the server second stopped moving or is far off. */
const STALE_OFFSET_MS = 10 * 60 * 1000;

/**
 * The Date header does not follow the clock: far from this computer's time (more than 10 minutes:
 * a computer is never that wrong in practice), or still the same second after more than 2 seconds.
 */
export function isStaleServerTime(previous: ClockProbe[], next: ClockProbe): boolean {
  if (Math.abs(next.serverSecondMs - next.receivedAt) > STALE_OFFSET_MS) return true;
  const first = previous[0];
  return Boolean(first && next.serverSecondMs === first.serverSecondMs && next.receivedAt - first.receivedAt > 2000);
}

export class TimeCalibrator {
  /** One calibration per site at a time: concurrent callers (tab focus, popup, alarm) share it. */
  private inFlight = new Map<string, Promise<ClockCalibration>>();

  private async probe(url: string): Promise<ClockProbe | null> {
    const sentAt = Date.now();
    const res = await fetch(url, { method: "HEAD", cache: "no-store", credentials: "omit" });
    const receivedAt = Date.now();
    const header = res.headers.get("Date");
    const serverSecondMs = header ? new Date(header).getTime() : NaN;
    if (!Number.isFinite(serverSecondMs)) return null;
    return { sentAt, receivedAt, serverSecondMs };
  }

  /**
   * Probes targetUrl back-to-back until `boundaries` second roll-overs were observed (or the time budget
   * runs out) and stores the median offset.
   */
  async calibrate(boundaries = 3, budgetMs = 6000, targetUrl?: string): Promise<ClockCalibration> {
    // Only the site being hunted is probed: there is no default site to fall back to.
    let urlHost: string;
    try {
      const u = new URL(targetUrl || "");
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("not http");
      urlHost = u.hostname.replace(/^www\./, "");
    } catch {
      throw new Error("A http(s) target URL is required to calibrate the clock");
    }
    const running = this.inFlight.get(urlHost);
    if (running) return running;
    const run = this.run(boundaries, budgetMs, targetUrl!, urlHost).finally(() => this.inFlight.delete(urlHost));
    this.inFlight.set(urlHost, run);
    return run;
  }

  private async run(boundaries: number, budgetMs: number, activeUrl: string, urlHost: string): Promise<ClockCalibration> {

    const probes: ClockProbe[] = [];
    const deadline = Date.now() + budgetMs;
    let seen = 0;
    let consecutiveFailures = 0;

    let switchedToPage = false;

    while (Date.now() < deadline && seen < boundaries) {
      try {
        const p = await this.probe(activeUrl);
        if (p) {
          consecutiveFailures = 0;
          // A file served from a CDN cache carries the time it was cached, not the current time
          // (e.g. Google's favicon). Then ask the site's own home page (same site, never another).
          if (!switchedToPage && isStaleServerTime(probes, p)) {
            switchedToPage = true;
            activeUrl = `${new URL(activeUrl).origin}/`;
            probes.length = 0;
            seen = 0;
            continue;
          }
          const last = probes[probes.length - 1];
          if (last && p.serverSecondMs === last.serverSecondMs + 1000) seen++;
          probes.push(p);

          // H5: Pace probes to prevent network spamming (~15-20 friendly requests max instead of ~190)
          await new Promise((r) => setTimeout(r, 80));
        } else {
          consecutiveFailures++;
        }
      } catch (err) {
        consecutiveFailures++;
        console.warn("[TimeCalibrator] Probe failed:", err);
      }

      // H5: If domain fails 3 times, abort probing this target (NEVER silently fall back to Shopee!)
      if (consecutiveFailures >= 3) {
        break;
      }

      if (consecutiveFailures > 0) {
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
          serverHost: urlHost,
        }
      : { offsetMs: 0, rttMs: medianRtt, errorMs: 1000, calibrated: false, lastCalibratedAt: Date.now(), serverHost: urlHost };

    // A failed run (site unreachable, no Date header) must not replace a good calibration
    if (calibration.calibrated) await storage.saveCalibration(calibration);
    return calibration;
  }
}

export const timeCalibrator = new TimeCalibrator();
