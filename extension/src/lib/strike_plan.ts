/**
 * Strike plan for a timed check-in: when to start each attempt so that the requests reach the
 * server spread around the drop moment T, computed from what was measured instead of fixed gaps.
 *
 * An attempt started at s is handled by the server at about  s + prep + oneWay  where
 *   prep   = time from the attempt start until the request leaves (mostly the Turnstile token),
 *            the median of earlier runs' measurements (Log tab history),
 *   oneWay = time from the request leaving until the server handles it. Learned from earlier
 *            check-in responses when there are some (the server verifies the Turnstile token with
 *            Cloudflare before answering, so this is much more than RTT / 2), else RTT / 2.
 * The arrival is uncertain by sigma, combining the clock calibration error, the spread of prep
 * and the spread of the server time.
 *
 * Two shapes:
 * - prep is short (no token wait): arrivals on normal quantiles of that uncertainty, shifted a bit
 *   past T, at least MIN_GAP_MS apart. Some land just before T, the next ones just after.
 * - prep is token-bound (>= TOKEN_BOUND_PREP_MS): the page solves one Turnstile challenge at a time,
 *   so only the first attempt really decides the arrival, and an attempt reaching the server before
 *   T is rejected after using up its token (the next one pays a whole new challenge, about a second).
 *   What must land after T is the request's RECEIPT (request sent + one-way network), so the margin
 *   only counts what moves the receipt: the clock error, the prep spread and the network spread.
 *   The server's own handling time (Turnstile verification, slower on busy nights) comes after the
 *   receipt and cannot make it early, so it does not widen the margin. The first receipt is placed
 *   TOKEN_SAFE_SIGMAS after T (after T in ~93% of the nights); the others are backups right after.
 * Start times follow by subtracting prep + oneWay.
 */

export interface StrikeInputs {
  /** Round trip to the site (ms); 0 if unknown. */
  rttMs: number;
  /** Clock calibration error bound (ms), see time_calibrator. */
  clockErrorMs: number;
  /** Earlier measurements of attempt start -> request sent (ms). */
  prepSamplesMs: number[];
  /** Earlier measurements of request sent -> check-in response (ms). */
  serverSamplesMs?: number[];
}

export interface StrikePlan {
  /** Start of each attempt relative to the first one (ms), ascending, first is 0. */
  offsetsMs: number[];
  /** How long before T the first attempt starts (ms). */
  leadMs: number;
  /** Planned server arrival of each attempt relative to T (ms). */
  arrivalsMs: number[];
  prepMs: number;
  oneWayMs: number;
  sigmaMs: number;
  /** The first attempt waits for a Turnstile token: arrivals placed after T only. */
  tokenBound: boolean;
}

export const STRIKE_PLAN = {
  MIN_ATTEMPTS: 5,
  MAX_ATTEMPTS: 8,
  /** Attempts closer than this would hit the server together. */
  MIN_GAP_MS: 20,
  MIN_SIGMA_MS: 10,
  /** Arrivals centred this many sigmas after T. */
  LATE_BIAS: 0.3,
  /** One-way latency assumed when RTT was never measured. */
  UNKNOWN_ONE_WAY_MS: 30,
  /** The engine prepares the strike 3.5 s ahead; the plan must start after that. */
  MAX_LEAD_MS: 3000,
  /** Prep at least this long means the attempt waits for a Turnstile token. */
  TOKEN_BOUND_PREP_MS: 300,
  /** Token-bound: first arrival this many sigmas after T. */
  SAFE_SIGMAS: 1,
  /** Token-bound: first receipt this many sigmas of the receipt time after T. */
  TOKEN_SAFE_SIGMAS: 1.5,
  /** With only 2-3 measurements their spread is inflated by this factor (small-sample caution). */
  SMALL_SAMPLE_INFLATION: 1.5,
  /** Spread never assumed below this from a handful of measurements (ms). */
  MIN_SAMPLE_JITTER_MS: 30,
  /** Learned server time is capped to this (a slow night must not push the start too far). */
  MAX_ONE_WAY_MS: 1000,
};

/** Inverse standard normal CDF (Acklam's rational approximation, |error| < 1.2e-9). */
export function normalQuantile(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pLow) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Sample standard deviation (n - 1). */
function stdDev(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1));
}

/**
 * Spread of a measured time: the interquartile range with 4+ samples (IQR / 1.349 = sigma for a
 * normal distribution); with 2-3 samples their standard deviation, inflated and floored; with a
 * single one nothing is known about the spread and `fallback` is used.
 */
function spreadOf(sorted: number[], fallback: number): number {
  const P = STRIKE_PLAN;
  if (sorted.length >= 4) return (quantile(sorted, 0.75) - quantile(sorted, 0.25)) / 1.349;
  if (sorted.length >= 2) return Math.max(P.MIN_SAMPLE_JITTER_MS, stdDev(sorted) * P.SMALL_SAMPLE_INFLATION);
  return fallback;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function planStrike(inputs: StrikeInputs): StrikePlan {
  const P = STRIKE_PLAN;
  const samples = inputs.prepSamplesMs.filter((v) => Number.isFinite(v) && v >= 0).sort((x, y) => x - y);

  // Prep time: median of history; its spread from the measurements (a quarter of the median while
  // there is only one).
  const prepMs = samples.length > 0 ? quantile(samples, 0.5) : 0;
  const prepJitter = spreadOf(samples, prepMs * 0.25);

  const rttKnown = inputs.rttMs > 0;
  const rttOneWay = rttKnown ? inputs.rttMs / 2 : P.UNKNOWN_ONE_WAY_MS;
  // The leaderboard time is taken while the server handles the request, just before it answers:
  // from the request leaving, that is the measured response time minus the way back.
  const server = (inputs.serverSamplesMs ?? []).filter((v) => Number.isFinite(v) && v > 0).sort((x, y) => x - y);
  const oneWayMs =
    server.length > 0 ? Math.min(P.MAX_ONE_WAY_MS, Math.max(rttOneWay, quantile(server, 0.5) - rttOneWay)) : rttOneWay;
  const netJitter =
    server.length >= 4
      ? (quantile(server, 0.75) - quantile(server, 0.25)) / 1.349
      : rttKnown || server.length > 0
      ? oneWayMs * 0.25
      : oneWayMs;

  // The calibration error is a bound (uniform within ±E): its sigma is E / sqrt(3).
  const clockSigma = Math.min(Math.max(inputs.clockErrorMs, 0), 1000) / Math.sqrt(3);
  const sigmaMs = Math.max(P.MIN_SIGMA_MS, Math.sqrt(clockSigma ** 2 + prepJitter ** 2 + netJitter ** 2));

  const tokenBound = prepMs >= P.TOKEN_BOUND_PREP_MS;
  const arrivalsMs: number[] = [];
  if (tokenBound) {
    // Arrivals are receipts: request sent + one-way network. Only what can move the receipt counts.
    const rttJitter = rttKnown ? rttOneWay * 0.25 : rttOneWay;
    const receiptSigma = Math.max(P.MIN_SIGMA_MS, Math.sqrt(clockSigma ** 2 + prepJitter ** 2 + rttJitter ** 2));
    const first = Math.max(P.MIN_GAP_MS, Math.round(P.TOKEN_SAFE_SIGMAS * receiptSigma));
    for (let i = 0; i < P.MIN_ATTEMPTS; i++) arrivalsMs.push(first + i * P.MIN_GAP_MS);
    const starts = arrivalsMs.map((a) => a - prepMs - rttOneWay);
    return {
      offsetsMs: starts.map((st) => Math.round(st - starts[0])),
      leadMs: Math.min(P.MAX_LEAD_MS, Math.round(-starts[0])),
      arrivalsMs,
      prepMs: Math.round(prepMs),
      oneWayMs: Math.round(rttOneWay),
      sigmaMs: Math.round(receiptSigma),
      tokenBound,
    };
  } else {
    // Enough attempts to cover about ±1.5 sigma at MIN_GAP_MS spacing, within [MIN, MAX].
    const n = Math.min(P.MAX_ATTEMPTS, Math.max(P.MIN_ATTEMPTS, Math.ceil((3 * sigmaMs) / P.MIN_GAP_MS) + 1));
    for (let i = 0; i < n; i++) {
      let a = sigmaMs * (normalQuantile((i + 0.5) / n) + P.LATE_BIAS);
      if (i > 0) a = Math.max(a, arrivalsMs[i - 1] + P.MIN_GAP_MS);
      arrivalsMs.push(Math.round(a));
    }
  }

  const starts = arrivalsMs.map((a) => a - prepMs - oneWayMs);
  const leadMs = Math.min(P.MAX_LEAD_MS, Math.round(-starts[0]));
  const offsetsMs = starts.map((s) => Math.round(s - starts[0]));

  return {
    offsetsMs,
    leadMs,
    arrivalsMs,
    prepMs: Math.round(prepMs),
    oneWayMs: Math.round(oneWayMs),
    sigmaMs: Math.round(sigmaMs),
    tokenBound,
  };
}
