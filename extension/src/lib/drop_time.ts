/** Shopee Vietnam drop times are in Vietnam time (GMT+7, no DST), whatever the computer's timezone is. */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Timestamp (ms) of the next hour:minute in Vietnam time at or after `nowMs` (minus a small grace). */
export function nextDropAt(hour: number, minute: number, nowMs: number, graceMs = 5000): number {
  const vnNow = new Date(nowMs + VN_OFFSET_MS); // read with getUTC* = Vietnam wall clock
  const candidate =
    Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate(), hour, minute, 0, 0) - VN_OFFSET_MS;
  return candidate >= nowMs - graceMs ? candidate : candidate + 24 * 60 * 60 * 1000;
}

/** "HH:mm:ss.SSS" in Vietnam time. */
export function formatVN(ms: number): string {
  const d = new Date(ms + VN_OFFSET_MS);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`;
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
