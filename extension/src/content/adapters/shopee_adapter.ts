import { MarketplaceAdapter } from "./adapter_interface";
import { elementResolver } from "../core/element_resolver";

export class ShopeeAdapter implements MarketplaceAdapter {
  platformName = "shopee";

  isMatchUrl(url: string): boolean {
    return url.includes("shopee.vn");
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
      // Match Shopee product pattern: -i.shopId.itemId or product/shopId/itemId
      const matchNew = url.match(/-i\.(\d+)\.(\d+)/);
      const matchOld = url.match(/\/product\/(\d+)\/(\d+)/);

      let shopId: string | undefined;
      let itemId: string | undefined;

      if (matchNew) {
        shopId = matchNew[1];
        itemId = matchNew[2];
      } else if (matchOld) {
        shopId = matchOld[1];
        itemId = matchOld[2];
      }

      if (!shopId && !itemId) return null;

      // Extract title from DOM
      const titleElem = document.querySelector<HTMLElement>(
        'h1, div.attM6q, span._44q_Fk, [data-testid="product-title"]'
      );
      const title = titleElem?.innerText?.trim() || document.title;

      // Extract price from DOM
      let price = 0;
      const priceElem = document.querySelector<HTMLElement>(
        "div.G27DQU, div.pmx_Fd, div.pqTWkA, .Y3b1y8"
      );
      if (priceElem) {
        const rawText = priceElem.innerText.replace(/[^\d]/g, "");
        price = parseInt(rawText, 10) || 0;
      }

      return {
        title,
        price,
        shopId,
        itemId,
      };
    } catch {
      return null;
    }
  }
}

export const shopeeAdapter = new ShopeeAdapter();
