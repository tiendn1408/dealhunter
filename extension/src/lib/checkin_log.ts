import { STORAGE_KEYS } from "./constants";

/** One tier tried within an attempt: 1 = page function, 2 = API, 3 = button click. */
export interface CheckInTier {
  tier: 1 | 2 | 3;
  ok: boolean;
  name?: string;
  error?: string;
}

/** One attempt as reported by the main-world helper (epoch ms of this machine). */
export interface CheckInAttempt {
  n: number;
  startAt: number;
  tiers: CheckInTier[];
  tokenStartAt?: number;
  tokenEndAt?: number;
  tokenError?: boolean;
  requestStartAt?: number;
  responseAt?: number;
  status?: number;
  /** Date header of the check-in response (1 s resolution). */
  serverDate?: string;
  /** What the server answered, short (message-like fields only, at most 160 characters). */
  reply?: string;
}

/** Summary of the strike plan a run followed (see strike_plan.ts). */
export interface CheckInPlanSummary {
  attempts: number;
  leadMs: number;
  prepMs: number;
  oneWayMs: number;
  sigmaMs: number;
  arrivalsMs: number[];
}

/** One strike sequence (or manual click) as reported by public/caffiliate_bridge.js. */
export interface CheckInRun {
  startAt: number;
  plan?: CheckInPlanSummary;
  source: "strike" | "manual";
  attempts: CheckInAttempt[];
  ok?: boolean;
  method?: string | null;
  error?: string;
}

/** Stored log entry: times already converted to the server clock. */
export interface CheckInLogEntry {
  /** Server time of the first attempt (epoch ms). */
  at: number;
  host: string;
  source: CheckInRun["source"];
  ok: boolean;
  method: string | null;
  error: string | null;
  plan: CheckInPlanSummary | null;
  attempts: Array<{
    n: number;
    /** Server clock HH:mm:ss.SSS */
    start: string;
    tiers: CheckInTier[];
    tokenMs: number | null;
    tokenError: boolean;
    sent: string | null;
    sentAfterMs: number | null;
    serverMs: number | null;
    status: number | null;
    /** Server's answer, short; absent in logs written before it was recorded. */
    reply?: string | null;
  }>;
}

export const MAX_CHECKIN_LOGS = 30;

export function serverClock(serverMs: number): string {
  const d = new Date(serverMs);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function toCheckInLogEntry(run: CheckInRun, offsetMs: number, host: string): CheckInLogEntry {
  const ms = (v: number | undefined) => (v === undefined ? null : Math.round(v));
  return {
    at: Math.round(run.startAt + offsetMs),
    host,
    source: run.source,
    ok: run.ok === true,
    method: run.method ?? null,
    error: run.error ?? null,
    plan: run.plan ?? null,
    attempts: run.attempts.map((a) => ({
      n: a.n,
      start: serverClock(a.startAt + offsetMs),
      tiers: a.tiers,
      tokenMs: a.tokenStartAt !== undefined && a.tokenEndAt !== undefined ? ms(a.tokenEndAt - a.tokenStartAt) : null,
      tokenError: Boolean(a.tokenError),
      sent: a.requestStartAt !== undefined ? serverClock(a.requestStartAt + offsetMs) : null,
      sentAfterMs: a.requestStartAt !== undefined ? ms(a.requestStartAt - a.startAt) : null,
      serverMs: a.requestStartAt !== undefined && a.responseAt !== undefined ? ms(a.responseAt - a.requestStartAt) : null,
      status: a.status ?? null,
      reply: a.reply ?? null,
    })),
  };
}

/** Plain-text line per attempt, for the console. */
export function describeAttempt(a: CheckInLogEntry["attempts"][number]): string {
  const tiers = a.tiers.map((t) => `T${t.tier} ${t.name ?? ""}${t.ok ? "" : ` ✗ ${t.error ?? ""}`}`.trim()).join(" → ");
  const parts = [`#${a.n} ${a.start}`, tiers];
  if (a.tokenMs !== null) parts.push(`Turnstile ${a.tokenMs}ms${a.tokenError ? " (error)" : ""}`);
  if (a.sent) parts.push(`sent ${a.sent} (+${a.sentAfterMs}ms)`);
  if (a.serverMs !== null) parts.push(`server ${a.serverMs}ms · HTTP ${a.status ?? "?"}`);
  if (a.reply) parts.push(`"${a.reply}"`);
  return parts.join(" · ");
}

/**
 * The attempt of each run whose request actually went out first, the one that waited for the
 * Turnstile token. Later attempts reuse the page's pending token and wait behind it: their times
 * say nothing about how long a check-in takes. Only runs whose first tier was the page function (or
 * a manual click) count: after a failed tier the time includes that failure.
 */
function firstSentAttempts(logs: CheckInLogEntry[], maxRuns: number, host?: string) {
  const out: CheckInLogEntry["attempts"] = [];
  // Only this site's runs: a test on the local simulator must not move the real site's plan
  const own = host ? logs.filter((l) => l.host === host) : logs;
  for (const log of own.slice(0, maxRuns)) {
    const a = log.attempts.find((x) => x.sentAfterMs !== null);
    const first = a?.tiers[0];
    if (!a || !first || !first.ok) continue;
    if (first.tier === 1 || log.source === "manual") out.push(a);
  }
  return out;
}

/** Measured "attempt start -> request sent" times of recent runs: the strike plan's prep estimate. */
export function prepSamplesFromLogs(logs: CheckInLogEntry[], maxRuns = 10, host?: string): number[] {
  return firstSentAttempts(logs, maxRuns, host).map((a) => a.sentAfterMs as number);
}

/** Measured "request sent -> answer" times of recent runs (successful answers only). */
export function serverSamplesFromLogs(logs: CheckInLogEntry[], maxRuns = 10, host?: string): number[] {
  return firstSentAttempts(logs, maxRuns, host)
    .filter((a) => a.serverMs !== null && a.status !== null && a.status >= 200 && a.status < 300)
    .map((a) => a.serverMs as number);
}

export async function getCheckInLogs(): Promise<CheckInLogEntry[]> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.CHECKIN_LOGS);
  const logs = data[STORAGE_KEYS.CHECKIN_LOGS];
  return Array.isArray(logs) ? logs : [];
}

export async function appendCheckInLog(entry: CheckInLogEntry): Promise<void> {
  const logs = await getCheckInLogs();
  await chrome.storage.local.set({ [STORAGE_KEYS.CHECKIN_LOGS]: [entry, ...logs].slice(0, MAX_CHECKIN_LOGS) });
}

export async function clearCheckInLogs(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.CHECKIN_LOGS);
}
