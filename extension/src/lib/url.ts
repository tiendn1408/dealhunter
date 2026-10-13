/**
 * URL normalization utility for reliable target matching and tab reuse.
 * Preserves functional query parameters (e.g. IDs, categories, views) and SPA hash routes,
 * while stripping transient marketing tracking parameters (utm_*, fbclid, etc.).
 */
export function normalizePageUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  try {
    const u = new URL(rawUrl.trim());
    const trackingParams = new Set([
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
      "ref",
      "ref_source",
      "aff_source",
      "traffic_source",
      "sp_source",
    ]);

    const cleanParams = new URLSearchParams();
    const sortedKeys = Array.from(new Set(u.searchParams.keys())).sort();
    for (const key of sortedKeys) {
      const lower = key.toLowerCase();
      if (!trackingParams.has(lower) && !lower.startsWith("utm_")) {
        const values = u.searchParams.getAll(key);
        for (const val of values) {
          cleanParams.append(key, val);
        }
      }
    }

    const search = cleanParams.toString();
    const searchPart = search ? `?${search}` : "";
    const hashPart = u.hash || "";
    const pathname = u.pathname.length > 1 && u.pathname.endsWith("/") ? u.pathname.slice(0, -1) : u.pathname;

    return `${u.origin}${pathname}${searchPart}${hashPart}`;
  } catch {
    return rawUrl.trim();
  }
}

export function isSamePageUrl(a: string, b: string): boolean {
  if (a === b) return true;
  return normalizePageUrl(a) === normalizePageUrl(b);
}

/**
 * Validates that a string is a well-formed HTTP or HTTPS URL (L2).
 * Rejects javascript:, file:, chrome:, data:, blob:, about: and invalid syntax.
 */
export function isValidHttpUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== "string") return false;
  try {
    const parsed = new URL(rawUrl.trim());
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * True when the URL's host is the given site or one of its subdomains. A site ending in "." matches
 * any country TLD ("shopee." -> shopee.vn, shopee.co.id). A URL that only mentions the site in its
 * path or query ("?ref=shopee.vn") does not match.
 */
export function isSiteHost(rawUrl: string, site: string): boolean {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  const labels = host.split(".");
  if (site.endsWith(".")) {
    // "<name>.<country suffix>": shopee.vn, shopee.co.id, shopee.com.my, but not shopee.evil.com
    const i = labels.lastIndexOf(site.slice(0, -1));
    if (i < 0) return false;
    return /^(?:[a-z]{2,3}|(?:co|com)\.[a-z]{2})$/.test(labels.slice(i + 1).join("."));
  }
  return host === site || host.endsWith("." + site);
}

/** Marketplaces DealHunter tracks prices for. */
const PRICE_SITES = ["shopee.", "lazada.", "tiki.vn", "tiktok.com"];

/**
 * Whether a page may ask DealHunter for its price context (an API call with the member's token):
 * only product pages of the marketplaces DealHunter tracks.
 */
export function isPriceContextUrl(rawUrl: string): boolean {
  return isValidHttpUrl(rawUrl) && PRICE_SITES.some((site) => isSiteHost(rawUrl, site));
}
