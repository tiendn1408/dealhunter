import { MarketplaceAdapter } from "./adapter_interface";
import { elementResolver } from "../core/element_resolver";

export class LazadaAdapter implements MarketplaceAdapter {
  platformName = "lazada";

  isMatchUrl(url: string): boolean {
    return url.includes("lazada.");
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
      const match = url.match(/-i(\d+)(?:-s(\d+))?/);
      const itemId = match ? match[1] : undefined;

      const titleElem = document.querySelector<HTMLElement>(
        "h1.pdp-mod-product-badge-title, .pdp-product-title, h1[data-spm-anchor-id], h1"
      );
      const title = titleElem?.innerText?.trim() || document.title;

      let price = 0;
      const priceElem = document.querySelector<HTMLElement>(
        ".pdp-price, .pdp-price_color_orange, .notranslate.pdp-price"
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

export const lazadaAdapter = new LazadaAdapter();
