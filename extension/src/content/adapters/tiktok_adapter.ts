import { MarketplaceAdapter } from "./adapter_interface";
import { elementResolver } from "../core/element_resolver";

export class TikTokAdapter implements MarketplaceAdapter {
  platformName = "tiktok";

  isMatchUrl(url: string): boolean {
    return url.includes("tiktok.com");
  }

  findVoucherButtons(keyword?: string): HTMLElement[] {
    return elementResolver.findCollectButtons(keyword);
  }

  isButtonFinished(button: HTMLElement): boolean {
    return elementResolver.isButtonFinished(button);
  }

  extractProductInfo(): { title: string; price: number; itemId?: string; shopId?: string } | null {
    try {
      const url = window.location.href;
      const match = url.match(/product\/(\d+)/) || url.match(/\/(\d{15,})/);
      const itemId = match ? match[1] : undefined;

      const titleElem = document.querySelector<HTMLElement>(
        'h1[data-testid*="product-title"], h1, [class*="product-title" i]'
      );
      const title = titleElem?.innerText?.trim() || document.title;

      let price = 0;
      const priceElem = document.querySelector<HTMLElement>(
        '[data-testid*="price"], .product-price, [class*="price-val" i], [class*="current-price" i]'
      );
      if (priceElem) {
        const rawText = priceElem.innerText.replace(/[^\d]/g, "");
        price = parseInt(rawText, 10) || 0;
      }

      return { title, price, itemId };
    } catch {
      return null;
    }
  }
}

export const tikTokAdapter = new TikTokAdapter();
