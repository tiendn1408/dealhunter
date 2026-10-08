export interface ScheduledTask {
  id: string;
  targetHour: number; // 0, 9, 12, 18, 21
  targetMinute: number; // usually 0
  targetUrl: string;
  label: string;
  mode: "semi_auto" | "full_auto";
  keyword?: string; // e.g. "500k", "15%"
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  createdAt: number;
  /** What the page actually showed at the end of the hunt. */
  lastResult?: {
    result: "saved" | "exhausted" | "not_found" | "timeout" | "cancelled";
    clicks: number;
    detail: string;
    finishedAt: number;
  };
}

export interface ClockCalibration {
  offsetMs: number; // ShopeeServerTime - LocalDeviceTime
  rttMs: number; // Round-trip time
  errorMs: number; // Estimated accuracy of offsetMs (+/-)
  calibrated: boolean; // false when no server second roll-over could be observed
  lastCalibratedAt: number;
}

export interface ExtensionSettings {
  burstIntervalMs: number; // default: 35ms
  burstDurationMs: number; // default: 2000ms
  preWarmSeconds: number; // default: 60s
  soundEnabled: boolean;
  autoCheckoutReady: boolean;
  dealHunterApiUrl: string;
  dealHunterWebUrl: string;
}

export interface HuntRuntimeState {
  isHunting: boolean;
  activeTaskId?: string;
  targetElementFound: boolean;
  clicksDispatched: number;
  lastResult?: "success" | "exhausted" | "timeout" | "error";
}

/** Signed-in DealHunter member session handed over by the web app; never a guest session. */
export interface WebSession {
  accessToken: string;
  expiresAt: number; // epoch ms
  email?: string;
  name?: string;
}

/** Real data from the user's DealHunter account for the product page being viewed. */
export interface ProductPriceContext {
  trackingId: string;
  title?: string;
  currentPrice: number | null; // null until DealHunter has fetched a price
  bestDealPlatform?: string;
  bestDealPrice?: number;
  savingsPercent?: number;
}

export type PriceContextResponse =
  | { signedIn: false }
  | { signedIn: true; context: ProductPriceContext | null; webUrl: string };
