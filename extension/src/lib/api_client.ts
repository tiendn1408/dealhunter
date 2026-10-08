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
  Title?: string;
  Platform?: string;
  CanonicalURL?: string;
  LastPrice?: number | null;
  LastEffectivePrice?: number | null;
}

/**
 * Reads the signed-in member's own DealHunter data. Runs in the background service worker (the API
 * only accepts requests carrying the member's access token; content scripts never see the token).
 */
export class DealHunterApiClient {
  private async get(path: string, token: string): Promise<Response> {
    const { dealHunterApiUrl } = await storage.getSettings();
    const res = await fetch(`${dealHunterApiUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
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
      const cmp = await cmpRes.json();
      const best = cmp?.best_deal;
      if (best && typeof best.effective_price === "number" && best.effective_price > 0) {
        context.bestDealPlatform = best.platform;
        context.bestDealPrice = best.effective_price;
        context.savingsPercent = typeof best.saving_percent === "number" ? best.saving_percent : undefined;
      }
    }
    return context;
  }
}

export const apiClient = new DealHunterApiClient();
