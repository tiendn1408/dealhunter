export const STORAGE_KEYS = {
  SCHEDULED_TASKS: "dh_scheduled_tasks",
  CLOCK_CALIBRATION: "dh_clock_calibration",
  SETTINGS: "dh_settings",
  WEB_SESSION: "dh_web_session", // chrome.storage.session: cleared when the browser closes
} as const;

/** DealHunter web origins allowed to hand their sign-in session to the extension (externally_connectable). */
export const DEALHUNTER_WEB_ORIGINS = ["http://localhost:3000", "http://localhost:3100", "https://dealhunter.vn"];

export const DEFAULT_SETTINGS = {
  burstIntervalMs: 35, // 35ms between clicks
  burstDurationMs: 2000, // 2.0s maximum burst window
  preWarmSeconds: 60, // Open tab 60s in advance
  soundEnabled: true,
  autoCheckoutReady: true,
  dealHunterApiUrl: "http://localhost:8080/api/v1",
  dealHunterWebUrl: "http://localhost:3000",
};

export const SHOPEE_FLASH_HOURS = [0, 9, 12, 15, 18, 21];

export const SHOPEE_URLS = {
  VOUCHER_HUB: "https://shopee.vn/m/ma-giam-gia",
  FREESHIP_HUB: "https://shopee.vn/m/mien-phi-van-chuyen",
  SUPER_SALE_1010: "https://shopee.vn/m/10-10",
  CART: "https://shopee.vn/cart",
  PING_TARGET: "https://shopee.vn/favicon.ico", // tiny static file: fast response, accurate Date header
};

export const MESSAGE_ACTIONS = {
  CALIBRATE_TIME: "CALIBRATE_TIME",
  GET_CALIBRATION: "GET_CALIBRATION",
  START_BURST_CLICK: "START_BURST_CLICK",
  STOP_BURST_CLICK: "STOP_BURST_CLICK",
  TASK_STATUS_UPDATE: "TASK_STATUS_UPDATE",
  TRIGGER_FULL_AUTO: "TRIGGER_FULL_AUTO",
  GET_PRICE_CONTEXT: "GET_PRICE_CONTEXT",
  GET_WEB_SESSION: "GET_WEB_SESSION",
} as const;

/** Message the DealHunter web app sends (chrome.runtime.sendMessage from the page) on sign-in, token refresh and sign-out. */
export const WEB_SESSION_MESSAGE = "DH_WEB_SESSION";
