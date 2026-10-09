/** Shopee Vietnam drop times are in Vietnam time (GMT+7, no DST), whatever the computer's timezone is. */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Timestamp (ms) of the next hour:minute in Vietnam time at or after `nowMs` (minus a small grace). */
export function nextDropAt(hour: number, minute: number, nowMs: number, graceMs = 5000): number {
  const vnNow = new Date(nowMs + VN_OFFSET_MS); // read with getUTC* = Vietnam wall clock
  const candidate =
    Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate(), hour, minute, 0, 0) - VN_OFFSET_MS;
  return candidate >= nowMs - graceMs ? candidate : candidate + 24 * 60 * 60 * 1000;
}

/** "HH:mm:ss.SS" in Vietnam time (standard 2 digits per unit: HH, mm, ss, SS). */
export function formatVN(ms: number, msDigits = 2): string {
  const d = new Date(ms + VN_OFFSET_MS);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  if (msDigits === 3) {
    return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`;
  }
  const hundredths = Math.floor(d.getUTCMilliseconds() / 10);
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(hundredths, 2)}`;
}

/** Next flash slot among `hours` (Vietnam time). */
export function nextFlashDrop(hours: number[], nowMs: number): { at: number; hour: number } {
  let best = { at: Infinity, hour: hours[0] };
  for (const h of hours) {
    const at = nextDropAt(h, 0, nowMs, 0);
    if (at > nowMs && at < best.at) best = { at, hour: h };
  }
  return best;
}

/** Timestamp (ms) of the exact hour:minute:second in Vietnam time at or after `nowMs`. */
export function nextExactDropAt(hour: number, minute: number, second: number, nowMs: number): number {
  const vnNow = new Date(nowMs + VN_OFFSET_MS);
  const candidate =
    Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate(), hour, minute, second, 0) - VN_OFFSET_MS;
  return candidate >= nowMs ? candidate : candidate + 24 * 60 * 60 * 1000;
}

/**
 * Formats a duration in milliseconds into standardized "HH:mm:ss.S" (e.g. "00:26:27.5").
 * Uses dynamic modulo calculations and 2-digit padding with zero hardcoding.
 */
export function formatCountdown(diffMs: number): string {
  const diff = Math.max(0, diffMs);
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1_000);
  const tenth = Math.floor((diff % 1_000) / 100);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${tenth}`;
}

