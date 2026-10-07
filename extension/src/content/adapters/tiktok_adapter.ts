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
}

export const tikTokAdapter = new TikTokAdapter();
