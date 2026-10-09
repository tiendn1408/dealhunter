import { ProductPriceContext, WebSession } from "./types";

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
  /** Item price; null when unknown. */
  listed_price?: number | null;
  /** null when the marketplace did not state it. */
  shipping_fee?: number | null;
  /** Item price plus shipping when the fee is known. */
  effective_price?: number | null;
}

interface Comparison {
  sources?: ComparisonSource[];
  /**
   * shipping_included=false: some source's shipping fee is unknown, so the sources were compared on item
   * prices and effective_price is the best item price.
   */
  best_deal?: { platform?: string; effective_price?: number | null; shipping_included?: boolean } | null;
}

const isPositive = (n: unknown): n is number => typeof n === "number" && n > 0;

/** The viewed source's item price: listed_price, or effective_price minus a known shipping fee. */
function itemPrice(s: ComparisonSource): number | undefined {
  if (isPositive(s.listed_price)) return s.listed_price;
  if (isPositive(s.effective_price) && typeof s.shipping_fee === "number" && s.shipping_fee >= 0) {
    const item = s.effective_price - s.shipping_fee;
    return item > 0 ? item : undefined;
  }
  return undefined;
}

/**
 * How much cheaper (percent) `bestPrice` is than the viewed Shopee source's own price, from the
 * comparison sources. The viewed source is the Shopee source of the tracking (same source ID, or the same
 * shop/item IDs when the ID is not available). Like is compared with like: with `shippingIncluded` the
 * effective prices (item + shipping), without it the item prices (as the best price then is one).
 * Undefined when the viewed price or the basis of the best price is unknown, or the viewed price is not higher.
 */
export function savingVsViewedSource(
  sources: ComparisonSource[] | undefined,
  tracking: { ProductSourceID?: string; CanonicalURL?: string },
  bestPrice: number,
  shippingIncluded: boolean | undefined
): number | undefined {
  if (!Array.isArray(sources) || !(bestPrice > 0) || typeof shippingIncluded !== "boolean") return undefined;
  const trackedIds = tracking.CanonicalURL ? shopeeIds(tracking.CanonicalURL) : null;
  const viewed = sources.find((s) => {
    if (s.platform !== "shopee") return false;
    if (tracking.ProductSourceID) return s.source_id === tracking.ProductSourceID;
    const ids = s.canonical_url ? shopeeIds(s.canonical_url) : null;
    return !!ids && !!trackedIds && ids.shopId === trackedIds.shopId && ids.itemId === trackedIds.itemId;
  });
  if (!viewed) return undefined;
  const viewedPrice = shippingIncluded ? viewed.effective_price : itemPrice(viewed);
  if (!isPositive(viewedPrice) || viewedPrice <= bestPrice) return undefined;
  return ((viewedPrice - bestPrice) / viewedPrice) * 100;
}

/**
 * Reads the signed-in member's own DealHunter data. Runs in the background service worker (the API
 * only accepts requests carrying the member's access token; content scripts never see the token).
 */
export class DealHunterApiClient {
  /** The token is only ever sent to the API it was issued for (stored with it in the session). */
  private async get(path: string, session: Pick<WebSession, "accessToken" | "apiUrl">): Promise<Response> {
    const res = await fetch(`${session.apiUrl}${path}`, { headers: { Authorization: `Bearer ${session.accessToken}` } });
    if (res.status === 401) throw new SessionRejectedError();
    return res;
  }

  /** Price context for a Shopee product page, or null when the member does not track that product. */
  async getProductPriceContext(productUrl: string, session: Pick<WebSession, "accessToken" | "apiUrl">): Promise<ProductPriceContext | null> {
    const ids = shopeeIds(productUrl);
    if (!ids) return null;

    const res = await this.get("/tracked-products", session);
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
    const cmpRes = await this.get(`/tracked-products/${matched.ID}/comparison`, session);
    if (cmpRes.ok) {
      const cmp = (await cmpRes.json()) as Comparison | null;
      const best = cmp?.best_deal;
      if (best && typeof best.effective_price === "number" && best.effective_price > 0) {
        context.bestDealPlatform = best.platform;
        context.bestDealPrice = best.effective_price;
        // Not the server's saving_percent: that one is relative to the most expensive source, not to
        // the Shopee listing being viewed
        context.savingsPercent = savingVsViewedSource(cmp?.sources, matched, best.effective_price, best.shipping_included);
      }
    }
    return context;
  }
}

export const apiClient = new DealHunterApiClient();
