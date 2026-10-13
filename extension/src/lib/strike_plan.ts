/**
 * Strike plan for a timed check-in: when to start each attempt so that the requests reach the
 * server spread around the drop moment T, computed from what was measured instead of fixed gaps.
 *
 * An attempt started at s reaches the server at about  s + prep + oneWay  where
 *   prep   = time from the attempt start until the request leaves (mostly the Turnstile token),
 *            the median of earlier attempts' measurements (Log tab history),
 *   oneWay = RTT / 2 to the site.
 * The arrival is uncertain by sigma, combining the clock calibration error, the spread of prep
 * and network jitter. Arrivals are placed on normal quantiles of that uncertainty, shifted a bit
 * past T (a request that lands before T is rejected, one just after T still ranks high), kept at
 * least MIN_GAP_MS apart. Start times follow by subtracting prep + oneWay.
 */

export interface StrikeInputs {
  /** Round trip to the site (ms); 0 if unknown. */
  rttMs: number;
  /** Clock calibration error bound (ms), see time_calibrator. */
  clockErrorMs: number;
  /** Earlier measurements of attempt start -> request sent (ms). */
  prepSamplesMs: number[];
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

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function planStrike(inputs: StrikeInputs): StrikePlan {
  const P = STRIKE_PLAN;
  const samples = inputs.prepSamplesMs.filter((v) => Number.isFinite(v) && v >= 0).sort((x, y) => x - y);

  // Prep time: median of history; spread from the interquartile range (IQR / 1.349 = sigma for a
  // normal distribution), or a quarter of the median while there are too few samples.
  const prepMs = samples.length > 0 ? quantile(samples, 0.5) : 0;
  const prepJitter =
    samples.length >= 4 ? (quantile(samples, 0.75) - quantile(samples, 0.25)) / 1.349 : prepMs * 0.25;

  const rttKnown = inputs.rttMs > 0;
  const oneWayMs = rttKnown ? inputs.rttMs / 2 : P.UNKNOWN_ONE_WAY_MS;
  const netJitter = rttKnown ? oneWayMs * 0.25 : oneWayMs;

  // The calibration error is a bound (uniform within ±E): its sigma is E / sqrt(3).
  const clockSigma = Math.min(Math.max(inputs.clockErrorMs, 0), 1000) / Math.sqrt(3);
  const sigmaMs = Math.max(P.MIN_SIGMA_MS, Math.sqrt(clockSigma ** 2 + prepJitter ** 2 + netJitter ** 2));

  // Enough attempts to cover about ±1.5 sigma at MIN_GAP_MS spacing, within [MIN, MAX].
  const n = Math.min(P.MAX_ATTEMPTS, Math.max(P.MIN_ATTEMPTS, Math.ceil((3 * sigmaMs) / P.MIN_GAP_MS) + 1));

  const arrivalsMs: number[] = [];
  for (let i = 0; i < n; i++) {
    let a = sigmaMs * (normalQuantile((i + 0.5) / n) + P.LATE_BIAS);
    if (i > 0) a = Math.max(a, arrivalsMs[i - 1] + P.MIN_GAP_MS);
    arrivalsMs.push(Math.round(a));
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
  };
}
