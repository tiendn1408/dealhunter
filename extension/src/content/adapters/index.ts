import { MarketplaceAdapter } from "./adapter_interface";
import { shopeeAdapter } from "./shopee_adapter";
import { lazadaAdapter } from "./lazada_adapter";
import { tikiAdapter } from "./tiki_adapter";
import { tikTokAdapter } from "./tiktok_adapter";
import { caffiliateAdapter } from "./caffiliate_adapter";

export * from "./adapter_interface";
export * from "./shopee_adapter";
export * from "./lazada_adapter";
export * from "./tiki_adapter";
export * from "./tiktok_adapter";
export * from "./caffiliate_adapter";

export const ADAPTERS: MarketplaceAdapter[] = [
  shopeeAdapter,
  lazadaAdapter,
  tikiAdapter,
  tikTokAdapter,
  caffiliateAdapter,
];

export function getAdapterForUrl(url: string): MarketplaceAdapter | null {
  for (const adapter of ADAPTERS) {
    if (adapter.isMatchUrl(url)) {
      return adapter;
    }
  }
  return null;
}
