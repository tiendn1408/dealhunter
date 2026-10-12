import { Language } from "../../lib/i18n";

export interface MarketplaceAdapter {
  platformName: string;
  isMatchUrl(url: string): boolean;
  findVoucherButtons(keyword?: string): HTMLElement[];
  isButtonFinished(button: HTMLElement): boolean;
  extractProductInfo?(): { title: string; price: number; itemId?: string; shopId?: string } | null;
  /**
   * Optional platform-specific direct strike hook (e.g. In-Page state unlock + execution)
   */
  executeDirectStrike?(target?: HTMLElement | null): Promise<boolean> | boolean;
  /**
   * Optional platform pre-warm strike hook (e.g. Turnstile CAPTCHA & Crypto Key pre-warming)
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
}


