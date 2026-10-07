import { elementResolver, VoucherDescriptor } from "./element_resolver";
import { humanClicker } from "./human_clicker";
import { WorkerTimer } from "./timer_worker";

/**
 * Outcome of one voucher hunt. Only what the page actually shows is reported:
 * - saved:     the button turned into "Đã lưu" / "Dùng ngay" / ...
 * - exhausted: the voucher shows "Hết lượt" / "Đã hết" / ...
 * - not_found: no matching voucher button appeared during the window
 * - timeout:   we clicked, but the page never confirmed saved or exhausted
 * - cancelled: the user stopped the hunt
 */
export type HuntResult = "saved" | "exhausted" | "not_found" | "timeout" | "cancelled";

export interface HuntOutcome {
  result: HuntResult;
  clicks: number;
  detail: string;
}

export interface Ticker {
  start(intervalMs: number, onTick: () => void): void;
  stop(): void;
}

export interface HuntOptions {
  /** Drop moment in Shopee server time (ms). */
  targetTimestamp: number;
  /** Current Shopee server time (ms). */
  now: () => number;
  /** Only vouchers whose card text contains this keyword (e.g. "50%", "500k"). */
  keyword?: string;
  /** Button the user locked in the HUD, if any. */
  locked?: HTMLElement | null;
  /** Start clicking this long before the drop to absorb clock error (ms). */
  leadMs?: number;
  /** Keep trying this long after the drop (ms). */
  windowMs?: number;
  clickIntervalMs?: number;
  maxClicks?: number;
  /** Timer source; defaults to a Web Worker ticker, which keeps running in background tabs. */
  ticker?: Ticker;
  onStatus?: (message: string) => void;
  onDone: (outcome: HuntOutcome) => void;
}

export const HUNT_DEFAULTS = {
  leadMs: 150,
  windowMs: 3000,
  clickIntervalMs: 35,
  maxClicks: 80,
  tickMs: 10,
};

/**
 * Runs one hunt: waits for the drop, then repeatedly re-finds the voucher button (the node can be
 * replaced when Shopee's countdown ends) and clicks it until the page shows a final state or the
 * window closes. Returns a function that cancels the hunt.
 */
export function startHunt(opts: HuntOptions): () => void {
  const leadMs = opts.leadMs ?? HUNT_DEFAULTS.leadMs;
  const windowMs = opts.windowMs ?? HUNT_DEFAULTS.windowMs;
  const clickIntervalMs = opts.clickIntervalMs ?? HUNT_DEFAULTS.clickIntervalMs;
  const maxClicks = opts.maxClicks ?? HUNT_DEFAULTS.maxClicks;
  const ticker = opts.ticker ?? new WorkerTimer();

  let descriptor: VoucherDescriptor | null = opts.locked ? elementResolver.describe(opts.locked) : null;
  let current: HTMLElement | null = opts.locked ?? null;
  let clicks = 0;
  let lastClickAt = -Infinity;
  let lastStatusAt = -Infinity;
  let scrolled = false;
  let done = false;

  const finish = (result: HuntResult, detail: string) => {
    if (done) return;
    done = true;
    ticker.stop();
    opts.onDone({ result, clicks, detail });
  };

  // Vouchers that could already be saved before the drop are not the drop; remembered so that,
  // without a lock or keyword, only a voucher that opens at the drop is clicked.
  const openBeforeDrop = new Set<string>();
  const key = (el: HTMLElement) => elementResolver.describe(el).cardText;

  // Re-find the target. A locked voucher is the ONLY acceptable target: if it cannot be found,
  // nothing is clicked (never fall back to a different voucher).
  const resolve = (atDrop: boolean): HTMLElement | null => {
    if (current && current.isConnected) return current;
    if (descriptor) {
      current = elementResolver.relocate(descriptor);
      return current;
    }
    if (!atDrop) return null;
    const candidates = elementResolver
      .findCollectButtons(opts.keyword)
      .filter((el) => opts.keyword || !openBeforeDrop.has(key(el)));
    current = candidates[0] ?? null;
    if (current) descriptor = elementResolver.describe(current);
    return current;
  };

  const status = (t: number, message: string) => {
    if (t - lastStatusAt >= 250) {
      lastStatusAt = t;
      opts.onStatus?.(message);
    }
  };

  ticker.start(HUNT_DEFAULTS.tickMs, () => {
    if (done) return;
    const t = opts.now();
    const untilDrop = opts.targetTimestamp - t;

    if (untilDrop > leadMs) {
      // Waiting: keep the target located and visible so the burst starts without searching
      if (untilDrop < 60_000) {
        if (!descriptor && !opts.keyword) {
          for (const el of elementResolver.findCollectButtons()) openBeforeDrop.add(key(el));
        }
        const el = resolve(false);
        if (el && !scrolled) {
          el.scrollIntoView({ block: "center" });
          scrolled = true;
        }
      }
      status(t, `Cho gio G: con ${(untilDrop / 1000).toFixed(1)}s`);
      return;
    }

    if (t > opts.targetTimestamp + windowMs) {
      if (clicks === 0) finish("not_found", "Khong tim thay nut voucher phu hop trong khung gio");
      else finish("timeout", `Da click ${clicks} lan nhung trang khong xac nhan da luu`);
      return;
    }

    const el = resolve(true);
    const state = elementResolver.getButtonState(el);
    if (state === "saved") return finish("saved", "Trang hien thi voucher da duoc luu");
    if (state === "exhausted") return finish("exhausted", "Voucher da het luot");

    if (el && state === "collectable" && t - lastClickAt >= clickIntervalMs && clicks < maxClicks) {
      if (humanClicker.dispatchClick(el)) {
        clicks++;
        lastClickAt = t;
      }
    }
    status(t, clicks > 0 ? `Dang luu ma... ${clicks} click` : "Dang tim nut voucher...");
  });

  return () => finish("cancelled", "Da huy");
}
