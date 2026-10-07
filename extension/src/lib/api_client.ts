import { storage } from "./storage";
import { ProductPriceContext } from "./types";

export class DealHunterApiClient {
  private async getBaseUrl(): Promise<string> {
    const settings = await storage.getSettings();
    return settings.dealHunterApiUrl;
  }

  async getProductPriceContext(productUrl: string): Promise<ProductPriceContext | null> {
    try {
      const baseUrl = await this.getBaseUrl();
      // First check if product is tracked
      const res = await fetch(`${baseUrl}/tracked-products`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) return null;

      const data = await res.json();
      const trackings = data.trackings || data || [];
      const matched = trackings.find(
        (t: any) =>
          t.canonical_url === productUrl ||
          (productUrl && t.canonical_url && productUrl.includes(t.canonical_url))
      );

      if (!matched) return null;

      // Fetch comparison to see best deal
      let bestDealPlatform: string | undefined;
      let bestDealPrice: number | undefined;
      let savingsPercent: number | undefined;

      try {
        const cmpRes = await fetch(`${baseUrl}/tracked-products/${matched.id}/comparison`);
        if (cmpRes.ok) {
          const cmpData = await cmpRes.json();
          if (cmpData.best_deal) {
            bestDealPlatform = cmpData.best_deal.platform;
            bestDealPrice = cmpData.best_deal.effective_price;
            savingsPercent = cmpData.best_deal.savings_percent;
          }
        }
      } catch {
        // Fallback silently if comparison not available
      }

      return {
        productId: matched.id,
        title: matched.title || "San pham theo doi",
        currentPrice: matched.last_price || 0,
        lowestPrice30d: matched.lowest_price,
        bestDealPlatform,
        bestDealPrice,
        savingsPercent,
      };
    } catch (err) {
      console.warn("[DealHunter] API connection skipped:", err);
      return null;
    }
  }

  async getVouchers(trackingOrSourceId: string): Promise<any[]> {
    try {
      const baseUrl = await this.getBaseUrl();
      const res = await fetch(`${baseUrl}/tracked-products/${trackingOrSourceId}/vouchers`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.vouchers || [];
    } catch {
      return [];
    }
  }
}

export const apiClient = new DealHunterApiClient();
