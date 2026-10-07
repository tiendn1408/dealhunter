export interface MarketplaceAdapter {
  platformName: string;
  isMatchUrl(url: string): boolean;
  findVoucherButtons(keyword?: string): HTMLElement[];
  isButtonFinished(button: HTMLElement): boolean;
  extractProductInfo?(): { title: string; price: number; itemId?: string; shopId?: string } | null;
}
