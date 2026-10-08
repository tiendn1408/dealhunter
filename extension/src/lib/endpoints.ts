import { DEALHUNTER_WEB_ORIGINS, DEFAULT_SETTINGS } from "./constants";

/**
 * DealHunter API / web URLs. Defaults are the local dev servers; in production the DealHunter web app
 * sends its own URLs with the session message (see web_session.ts). Every URL is validated before use:
 * the access token is only ever sent to a DealHunter API host.
 */
export interface DealHunterEndpoints {
  apiUrl: string;
  webUrl: string;
}

const LOCAL_HOSTS = ["localhost", "127.0.0.1"];

function parseHttpUrl(value: unknown): URL | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  return url;
}

function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.includes(hostname);
}

function isDealHunterHost(hostname: string): boolean {
  return hostname === "dealhunter.vn" || hostname.endsWith(".dealhunter.vn");
}

/**
 * The API base URL (e.g. "https://api.dealhunter.vn/api/v1") normalized without a trailing slash, or null
 * when it is not http(s) on an allowed host: localhost (dev), or dealhunter.vn / *.dealhunter.vn over https.
 * Query strings and fragments are rejected (they would corrupt every request path).
 */
export function validateApiUrl(value: unknown): string | null {
  const url = parseHttpUrl(value);
  if (!url || url.search || url.hash) return null;
  const host = url.hostname.toLowerCase();
  const allowed = isLocalHost(host) || (url.protocol === "https:" && isDealHunterHost(host));
  if (!allowed) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/**
 * The web app origin (e.g. "https://dealhunter.vn"), or null unless it is an http(s) origin listed in
 * DEALHUNTER_WEB_ORIGINS and, when given, the origin of the page that sent it.
 */
export function validateWebUrl(value: unknown, senderOrigin?: string): string | null {
  const url = parseHttpUrl(value);
  if (!url) return null;
  const origin = url.origin;
  if (!DEALHUNTER_WEB_ORIGINS.includes(origin)) return null;
  if (senderOrigin !== undefined && origin !== senderOrigin) return null;
  return origin;
}

/** Stored URLs re-validated on every read; anything invalid falls back to the dev defaults. */
export function resolveEndpoints(stored: { dealHunterApiUrl?: unknown; dealHunterWebUrl?: unknown }): DealHunterEndpoints {
  return {
    apiUrl: validateApiUrl(stored.dealHunterApiUrl) ?? DEFAULT_SETTINGS.dealHunterApiUrl,
    webUrl: validateWebUrl(stored.dealHunterWebUrl) ?? DEFAULT_SETTINGS.dealHunterWebUrl,
  };
}
