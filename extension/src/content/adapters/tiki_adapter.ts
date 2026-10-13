import { MarketplaceAdapter } from "./adapter_interface";
import { elementResolver } from "../core/element_resolver";
import { isSiteHost } from "../../lib/url";

export class TikiAdapter implements MarketplaceAdapter {
  platformName = "tiki";

  isMatchUrl(url: string): boolean {
    return isSiteHost(url, "tiki.vn");
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
      const match = url.match(/-p(\d+)\.html/);
      const itemId = match ? match[1] : undefined;

      const titleElem = document.querySelector<HTMLElement>(
        'h1[class*="Title"], h1[data-view-id="pdp_details_title"], h1'
      );
      const title = titleElem?.innerText?.trim() || document.title;

      let price = 0;
      const priceElem = document.querySelector<HTMLElement>(
        'div[class*="product-price__current-price"], [data-view-id="pdp_product_price"], .flash-sale-price'
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

export const tikiAdapter = new TikiAdapter();
