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

/** Where the true offset (serverTime - localTime) can be: lo <= offset <= hi. */
export interface OffsetBracket {
  lo: number;
  hi: number;
}

/**
 * One probe aimed at the server's second boundary `boundaryMs`. Taking the server's moment as the
 * probe's midpoint (as estimateOffsetFromProbes does), the answer tells on which side of the boundary
 * that moment was: the new second means offset >= boundary - mid, the old one offset < boundary - mid.
 * When the two edges cross (the midpoint is only an approximation of the server's moment), the
 * offset is between them, so they are swapped rather than dropped.
 */
export function narrowBracket(bracket: OffsetBracket, probe: ClockProbe, boundaryMs: number): OffsetBracket {
  const mid = (probe.sentAt + probe.receivedAt) / 2;
  const edge = boundaryMs - mid;
  let { lo, hi } = bracket;
  if (probe.serverSecondMs >= boundaryMs) lo = Math.max(lo, edge);
  else hi = Math.min(hi, edge);
  return lo <= hi ? { lo, hi } : { lo: hi, hi: lo };
}

/** Aim at a boundary at least this far ahead, so the probe can be sent on time. */
const REFINE_AIM_AHEAD_MS = 150;

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
  async calibrate(boundaries = 3, budgetMs = 6000, targetUrl?: string, refineRounds = 0): Promise<ClockCalibration> {
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
    const run = this.run(boundaries, budgetMs, targetUrl!, urlHost, refineRounds).finally(() => this.inFlight.delete(urlHost));
    this.inFlight.set(urlHost, run);
    return run;
  }

  private async run(
    boundaries: number,
    budgetMs: number,
    activeUrl: string,
    urlHost: string,
    refineRounds = 0
  ): Promise<ClockCalibration> {

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
    let estimate = estimateOffsetFromProbes(probes);

    // Precise mode: aim single probes at the next second boundaries and halve the bracket each time
    // (one probe per second, about refineRounds seconds), from ~RTT/2 + pacing down to a few ms.
    if (estimate && refineRounds > 0) {
      estimate = await this.refine(estimate, refineRounds, activeUrl, medianRtt, rtts);
    }

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

  private async refine(
    rough: { offsetMs: number; errorMs: number },
    rounds: number,
    url: string,
    medianRtt: number,
    roughRtts: number[]
  ): Promise<{ offsetMs: number; errorMs: number }> {
    let bracket: OffsetBracket = { lo: rough.offsetMs - rough.errorMs, hi: rough.offsetMs + rough.errorMs };
    const rtts = [...roughRtts];
    for (let r = 0; r < rounds && bracket.hi - bracket.lo > 2; r++) {
      const center = (bracket.lo + bracket.hi) / 2;
      const boundary = Math.ceil((Date.now() + center + medianRtt / 2 + REFINE_AIM_AHEAD_MS) / 1000) * 1000;
      // Send so that the probe's midpoint falls on the boundary if the offset is the bracket's centre
      const sendAt = boundary - center - medianRtt / 2;
      await new Promise((res) => setTimeout(res, Math.max(0, sendAt - Date.now())));
      let p: ClockProbe | null = null;
      try {
        p = await this.probe(url);
      } catch {
        p = null;
      }
      if (!p) continue;
      // Aimed at the boundary, the answer can only be the second before it or the boundary's own:
      // anything else means the server clock jumped or the answer was cached. Trust none of it.
      if (p.serverSecondMs !== boundary && p.serverSecondMs !== boundary - 1000) return rough;
      rtts.push(p.receivedAt - p.sentAt);
      bracket = narrowBracket(bracket, p, boundary);
    }
    const offsetMs = Math.round((bracket.lo + bracket.hi) / 2);
    // A refined offset outside the rough one (plus an RTT) means the probes went wrong: keep the rough
    if (Math.abs(offsetMs - rough.offsetMs) > rough.errorMs + medianRtt) return rough;
    // The midpoint is not exactly the server's moment: add half the spread of the round trips
    rtts.sort((a, b) => a - b);
    const q = (f: number) => rtts[Math.min(rtts.length - 1, Math.floor((rtts.length - 1) * f))] ?? 0;
    const rttSpread = rtts.length >= 4 ? q(0.75) - q(0.25) : medianRtt / 2;
    const errorMs = Math.min(rough.errorMs, Math.max(2, Math.round((bracket.hi - bracket.lo) / 2 + rttSpread / 2)));
    return { offsetMs, errorMs };
  }
}

export const timeCalibrator = new TimeCalibrator();
