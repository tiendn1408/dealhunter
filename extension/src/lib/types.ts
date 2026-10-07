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
}

export interface HuntRuntimeState {
  isHunting: boolean;
  activeTaskId?: string;
  targetElementFound: boolean;
  clicksDispatched: number;
  lastResult?: "success" | "exhausted" | "timeout" | "error";
}

export interface ProductPriceContext {
  productId: string;
  title: string;
  currentPrice: number;
  lowestPrice30d?: number;
  medianPrice90d?: number;
  bestDealPlatform?: string;
  bestDealPrice?: number;
  savingsPercent?: number;
}
