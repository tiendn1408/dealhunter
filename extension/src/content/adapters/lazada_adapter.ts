import { MarketplaceAdapter } from "./adapter_interface";
import { elementResolver } from "../core/element_resolver";

export class LazadaAdapter implements MarketplaceAdapter {
  platformName = "lazada";

  isMatchUrl(url: string): boolean {
    return url.includes("lazada.vn");
  }

  findVoucherButtons(keyword?: string): HTMLElement[] {
    return elementResolver.findCollectButtons(keyword);
  }

  isButtonFinished(button: HTMLElement): boolean {
    return elementResolver.isButtonFinished(button);
  }
}

export const lazadaAdapter = new LazadaAdapter();
