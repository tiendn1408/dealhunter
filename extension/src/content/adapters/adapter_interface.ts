import { Language } from "../../lib/i18n";

export interface MarketplaceAdapter {
  platformName: string;
  isMatchUrl(url: string): boolean;
  findVoucherButtons(keyword?: string): HTMLElement[];
  isButtonFinished(button: HTMLElement): boolean;
  extractProductInfo?(): { title: string; price: number; itemId?: string; shopId?: string } | null;
  /**
   * Optional hook a few seconds before the drop (e.g. start timing collection, warm connections).
   */
  preWarmStrike?(): Promise<void> | void;
  /**
   * Optional platform directive: whether to suppress destructive page reload before/at drop
   */
  shouldDisableReload?(): boolean;
  /**
   * Optional platform directive: max clicks for this platform (e.g. 1 for single-action check-in)
   */
  maxClicks?: number;
  /**
   * Optional platform directive: hunt window duration in ms (e.g. 8000 for Caffiliate to allow Turnstile completion)
   */
  windowMs?: number;
  /**
   * Optional platform directive: dynamic status text override for HUD (return null/undefined to use default)
   */
  getStatusOverride?(lang?: Language): string | null;
  /**
   * Optional platform detail appended to the hunt result (e.g. measured check-in timings)
   */
  getResultDetail?(): string | null;
}


