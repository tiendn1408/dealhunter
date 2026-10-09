export type ClickProfileMode = "adaptive" | "stealth" | "pro_gamer" | "turbo";

export interface ScheduledTask {
  id: string;
  targetHour: number; // 0..23
  targetMinute: number; // 0..59
  targetSecond?: number; // 0..59
  targetUrl: string;
  label: string;
  mode: "semi_auto" | "full_auto";
  keyword?: string; // fallback voucher keyword
  savedTargetId?: string; // linked SavedPageTarget
  descriptor?: {
    id?: string;
    uniqueSelector: string;
    tagName: string;
    attributes: Record<string, string>;
    initialText: string;
    childIndex?: number;
    parentSelector?: string;
    rect?: { top: number; left: number; width: number; height: number };
    containerText?: string;
    valueTokens?: string[];
  };
  preWarmSeconds?: number; // lead time before target to open/focus tab (default: 60)
  dualDefenseReload?: boolean; // automatically executes pre-warm reload & emergency fallback if static
  clickProfileMode?: ClickProfileMode; // default: "adaptive"
  diagnostics?: TargetDiagnosticsSummary;
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
  offsetMs: number; // ServerTime - LocalDeviceTime
  rttMs: number; // Round-trip time
  errorMs: number; // Estimated accuracy of offsetMs (+/-)
  calibrated: boolean; // false when no server second roll-over could be observed
  lastCalibratedAt: number;
  serverHost?: string; // Host domain probed, e.g. "shopee.vn" or "app.caffiliate.vn"
}

export interface ExtensionSettings {
  language: "en" | "vi"; // default: 'en'
  burstIntervalMs: number; // default: 35ms
  burstDurationMs: number; // default: 2000ms
  clickProfileMode?: ClickProfileMode; // default: "adaptive"
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
  /** The API the token was issued for (sent with it by the web app): the token is only ever sent there. */
  apiUrl: string;
  /** The web app that sent the token; undefined when it sent no valid URL. */
  webUrl?: string;
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

/** Persistent target configuration saved locally in browser per page URL */
export interface SavedPageTarget {
  id: string;
  url: string;
  origin: string;
  name: string;
  targetSlot: "quick_10s" | "quick_30s" | "midnight" | "next_minute" | "custom";
  customTime?: string;
  descriptor: {
    id?: string;
    uniqueSelector: string;
    tagName: string;
    attributes: Record<string, string>;
    initialText: string;
    childIndex?: number;
    parentSelector?: string;
    rect?: { top: number; left: number; width: number; height: number };
    containerText?: string;
    valueTokens?: string[];
  };
  dualDefenseReload?: boolean;
  diagnostics?: TargetDiagnosticsSummary;
  updatedAt: number;
}

export type PageFramework = "react" | "vue" | "angular" | "svelte" | "unknown";

export type ReloadStrategy = "reactive_no_reload" | "static_dual_defense";

export interface TargetDiagnosticsSummary {
  framework: PageFramework;
  hasCountdownTimer: boolean;
  countdownSnippet?: string;
  isTicking: boolean;
  isStandby: boolean;
  strategy: ReloadStrategy;
  confidence: number;
}

