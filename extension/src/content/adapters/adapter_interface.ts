import { Language } from "../../lib/i18n";

export interface MarketplaceAdapter {
  platformName: string;
  isMatchUrl(url: string): boolean;
  findVoucherButtons(keyword?: string): HTMLElement[];
  isButtonFinished(button: HTMLElement): boolean;
  /**
   * Optional: the site itself confirmed success (e.g. Caffiliate's own check-in state). The engine
   * finishes on it at once; only adapters that can tell for sure implement it.
   */
  confirmsCompletion?(button: HTMLElement): boolean;
  extractProductInfo?(): { title: string; price: number; itemId?: string; shopId?: string } | null;
  /**
   * Optional platform strike used instead of the first click (e.g. Caffiliate: the page's own
   * app.checkIn()). Returns true when the strike was dispatched.
   */
  executeDirectStrike?(target?: HTMLElement | null): Promise<boolean> | boolean;
  /**
   * Optional: the direct strike does not need the target button (e.g. Caffiliate calls the page's own
   * check-in). The engine then strikes on time even when the button cannot be found or looks done;
   * the button is only read afterwards to confirm the result.
   */
  strikesWithoutTarget?(): boolean;
  /**
   * Optional platform schedule: how long before the drop the direct strike starts (ms).
   * Recomputed by the engine right after preWarmStrike().
   */
  planStrike?(): { leadMs: number };
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
}


