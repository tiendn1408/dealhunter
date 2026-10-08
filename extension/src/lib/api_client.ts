import { storage } from "./storage";
import { ProductPriceContext } from "./types";

/** The access token was rejected (expired or revoked); the caller should drop the session. */
export class SessionRejectedError extends Error {}

/** Shop and item IDs from a Shopee product URL (`...-i.<shop>.<item>` or `/product/<shop>/<item>`). */
export function shopeeIds(url: string): { shopId: string; itemId: string } | null {
  const m = url.match(/-i\.(\d+)\.(\d+)/) || url.match(/\/product\/(\d+)\/(\d+)/);
  return m ? { shopId: m[1], itemId: m[2] } : null;
}

interface Tracking {
  ID: string;
  ProductSourceID?: string;
  Title?: string;
  Platform?: string;
  CanonicalURL?: string;
  LastPrice?: number | null;
  LastEffectivePrice?: number | null;
}

interface ComparisonSource {
  source_id?: string;
  platform?: string;
  canonical_url?: string;
  effective_price?: number | null;
}

interface Comparison {
  sources?: ComparisonSource[];
  best_deal?: { platform?: string; effective_price?: number | null } | null;
}

/**
 * How much cheaper (percent) `bestPrice` is than the viewed Shopee source's own effective price, from the
 * comparison sources. The viewed source is the Shopee source of the tracking (same source ID, or the same
 * shop/item IDs when the ID is not available). Undefined when that price is unknown or not higher.
 */
export function savingVsViewedSource(
  sources: ComparisonSource[] | undefined,
  tracking: { ProductSourceID?: string; CanonicalURL?: string },
  bestPrice: number
): number | undefined {
  if (!Array.isArray(sources) || !(bestPrice > 0)) return undefined;
  const trackedIds = tracking.CanonicalURL ? shopeeIds(tracking.CanonicalURL) : null;
  const viewed = sources.find((s) => {
    if (s.platform !== "shopee") return false;
    if (tracking.ProductSourceID) return s.source_id === tracking.ProductSourceID;
    const ids = s.canonical_url ? shopeeIds(s.canonical_url) : null;
    return !!ids && !!trackedIds && ids.shopId === trackedIds.shopId && ids.itemId === trackedIds.itemId;
  });
  const viewedPrice = viewed?.effective_price;
  if (typeof viewedPrice !== "number" || !(viewedPrice > 0) || viewedPrice <= bestPrice) return undefined;
  return ((viewedPrice - bestPrice) / viewedPrice) * 100;
}

/**
 * Reads the signed-in member's own DealHunter data. Runs in the background service worker (the API
 * only accepts requests carrying the member's access token; content scripts never see the token).
 */
export class DealHunterApiClient {
  private async get(path: string, token: string): Promise<Response> {
    const { apiUrl } = await storage.getEndpoints();
    const res = await fetch(`${apiUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) throw new SessionRejectedError();
    return res;
  }

  /** Price context for a Shopee product page, or null when the member does not track that product. */
  async getProductPriceContext(productUrl: string, token: string): Promise<ProductPriceContext | null> {
    const ids = shopeeIds(productUrl);
    if (!ids) return null;

    const res = await this.get("/tracked-products", token);
    if (!res.ok) throw new Error(`DealHunter API HTTP ${res.status}`);
    const { data } = (await res.json()) as { data?: Tracking[] };
    const matched = (data || []).find((t) => {
      if (t.Platform !== "shopee" || !t.CanonicalURL) return false;
      const tIds = shopeeIds(t.CanonicalURL);
      return !!tIds && tIds.shopId === ids.shopId && tIds.itemId === ids.itemId;
    });
    if (!matched) return null;

    const context: ProductPriceContext = {
      trackingId: matched.ID,
      title: matched.Title || undefined,
      currentPrice: matched.LastEffectivePrice ?? matched.LastPrice ?? null,
    };

    // The comparison is optional: without it the badge just has no cross-platform line
    const cmpRes = await this.get(`/tracked-products/${matched.ID}/comparison`, token);
    if (cmpRes.ok) {
      const cmp = (await cmpRes.json()) as Comparison | null;
      const best = cmp?.best_deal;
      if (best && typeof best.effective_price === "number" && best.effective_price > 0) {
        context.bestDealPlatform = best.platform;
        context.bestDealPrice = best.effective_price;
        // Not the server's saving_percent: that one is relative to the most expensive source, not to
        // the Shopee listing being viewed
        context.savingsPercent = savingVsViewedSource(cmp?.sources, matched, best.effective_price);
      }
    }
    return context;
  }
}

export const apiClient = new DealHunterApiClient();
