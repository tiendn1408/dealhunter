import ReactDOM from "react-dom/client";
import { FloatingHUD } from "./ui/FloatingHUD";
import { PriceHistoryBadge } from "./ui/PriceHistoryBadge";
import { huntCoordinator, ARMED_SESSION_KEY } from "./core/hunt_coordinator";
import { elementResolver } from "./core/element_resolver";
import { nextExactDropAt } from "../lib/drop_time";
import { ScheduledTask } from "../lib/types";
import { MESSAGE_ACTIONS } from "../lib/constants";
import { storage } from "../lib/storage";
import { isSamePageUrl, isSiteHost } from "../lib/url";
import { caffiliateAdapter } from "./adapters/caffiliate_adapter";
import { reloadTiming } from "../lib/reload_timing";
import { hudBus } from "./ui/hud_bus";
import { detectPlatformBlock } from "./platform_block";
import { platformBlockMessage } from "./ui/status_text";
import { getTranslation } from "../lib/i18n";
import type { UniversalTargetDescriptor } from "./core/element_resolver";
import "./ui/style.css";

function isTopWindow(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  try {
    if (window.top !== window) return false;
    const contentType = document.contentType || "";
    if (
      contentType === "image/svg+xml" ||
      contentType === "application/xml" ||
      contentType === "text/xml" ||
      contentType === "application/pdf" ||
      (document.documentElement && document.documentElement.nodeName.toLowerCase() === "svg") ||
      !(document.createElement("div") && document.createElement("div").style)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

let hudRoot: ReactDOM.Root | null = null;
let badgeRoot: ReactDOM.Root | null = null;

// 2. Inject Floating HUD on voucher/campaign/cart pages or pages with a saved target / scheduled task / armed session
export function isECommerceVoucherOrDealPage(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    // Decision 3: only shopping sites; a voucher path on an unknown site is not enough
    const isECommerceDomain = ["shopee.", "lazada.", "tiki.vn", "tiktok.com", "sendo.vn", "aliexpress.", "taobao.com"].some(
      (site) => isSiteHost(urlStr, site)
    );
    if (!isECommerceDomain) return false;

    // Hub / deal paths: a whole path segment ("/m/..." yes, "/me" or "/messages" no)
    const full = (url.pathname + url.hash).toLowerCase();
    return /(?:^|[/#])(m|voucher|vouchers|coupon|coupons|ma-giam-gia|khuyen-mai|uu-dai|giam-gia|flash-sale|flashsale|deal|deals|campaign|super-sale|cart|checkout|gio-hang|wow|promotion)(?:[/?#]|$)/.test(
      full
    );
  } catch {
    return false;
  }
}

async function injectFloatingHUD(force = false, autoPick = false) {
  const isVoucherPage = isECommerceVoucherOrDealPage(window.location.href);

  let hasSavedTarget = false;
  let hasScheduledTask = false;
  let hasArmedSession = false;

  try {
    const raw = sessionStorage.getItem(ARMED_SESSION_KEY);
    if (raw) {
      const sess = JSON.parse(raw);
      if (sess.url && isSamePageUrl(sess.url, window.location.href)) {
        hasArmedSession = true;
      }
    }
  } catch {
    // ignore
  }

  if (!force && !isVoucherPage && !hasArmedSession) {
    try {
      const saved = await storage.getSavedTargetForUrl(window.location.href);
      hasSavedTarget = !!saved;
    } catch {
      // ignore
    }

    if (!hasSavedTarget) {
      try {
        const tasks = await storage.getTasks();
        const currentUrl = window.location.href;
        hasScheduledTask = tasks.some((t) => {
          if (t.status === "completed" || t.status === "failed" || t.status === "cancelled" || t.status === "missed") return false;
          return isSamePageUrl(t.targetUrl, currentUrl);
        });
      } catch {
        // ignore
      }
    }
  }

  if (!force && !isVoucherPage && !hasSavedTarget && !hasScheduledTask && !hasArmedSession) return;
  if (document.getElementById("dealhunter-hud-root")) {
    if (autoPick) {
      hudBus.requestPick();
    }
    return;
  }

  const container = document.createElement("div");
  container.id = "dealhunter-hud-root";
  document.body.appendChild(container);

  hudRoot = ReactDOM.createRoot(container);
  hudRoot.render(
    <FloatingHUD
      onClose={() => {
        try {
          hudRoot?.unmount();
        } catch {
          // ignore
        }
        container.remove();
        hudRoot = null;
      }}
      hostElement={container}
      autoPick={autoPick}
    />
  );
}

// 3. Inject Price History Badge on product pages
export function isECommerceProductPage(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    const path = url.pathname.toLowerCase();
    const on = (site: string) => isSiteHost(urlStr, site);

    if (on("shopee.") && (path.includes("-i.") || path.includes("/product/"))) return true;
    if (on("lazada.") && (path.includes("/products/") || path.includes("-i") || path.endsWith(".html"))) return true;
    if (on("tiki.vn") && (path.includes("-p") || path.endsWith(".html"))) return true;
    if (on("tiktok.com") && (path.includes("/product/") || path.includes("/view/product"))) return true;
    return false;
  } catch {
    return false;
  }
}

function injectPriceHistoryBadge() {
  if (!isECommerceProductPage(window.location.href)) return;
  if (document.getElementById("dealhunter-badge-root")) return;

  const container = document.createElement("div");
  container.id = "dealhunter-badge-root";
  document.body.appendChild(container);

  badgeRoot = ReactDOM.createRoot(container);
  badgeRoot.render(<PriceHistoryBadge />);
}

/**
 * Learns how fast this page loads, for the pre-reload lead (lib/reload_timing): on a page with an
 * armed hunt or a saved target, the time from navigation start until the target button is found.
 * Skipped when the page loaded in the background (throttled) or came from the back/forward cache.
 */
async function measurePageReadyTime() {
  if (document.visibilityState !== "visible") return;
  const nav = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (nav && nav.type === "back_forward") return;

  let desc: UniversalTargetDescriptor | undefined;
  try {
    const raw = sessionStorage.getItem(ARMED_SESSION_KEY);
    const sess = raw ? JSON.parse(raw) : null;
    if (sess?.descriptor && sess.url && isSamePageUrl(sess.url, window.location.href)) desc = sess.descriptor;
  } catch {
    // ignore
  }
  if (!desc) {
    try {
      desc = (await storage.getSavedTargetForUrl(window.location.href))?.descriptor;
    } catch {
      // ignore
    }
  }
  if (!desc) return;

  const url = window.location.href;
  reloadTiming.load(url).catch(() => {});
  const deadline = performance.now() + 15000;
  const poll = () => {
    if (document.visibilityState !== "visible") return; // went to background: the sample would be skewed
    if (elementResolver.relocateUniversal(desc!)) {
      reloadTiming.record(url, performance.now()).catch(() => {});
      return;
    }
    if (performance.now() < deadline) setTimeout(poll, 50);
  };
  poll();
}

function initContentScript() {
  console.log("[DealHunter Assistant] Content script injected on", window.location.href);

  // 1. Clock calibration starts only where it is needed: the HUD, an armed hunt or a scheduled
  // task call timeSyncClient.init() (decision 2: ordinary pages are never probed).
  // Caffiliate: log where the time goes on every check-in attempt, manual or hunted.
  if (caffiliateAdapter.isMatchUrl(window.location.href)) caffiliateAdapter.listenForTimings();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      injectFloatingHUD();
      injectPriceHistoryBadge();
      checkAndResumeScheduledTasks();
      measurePageReadyTime();
    });
  } else {
    injectFloatingHUD();
    injectPriceHistoryBadge();
    checkAndResumeScheduledTasks();
    measurePageReadyTime();
  }
}

const isTestEnv = typeof process !== "undefined" && process.env.NODE_ENV === "test";
if (isTopWindow() && !isTestEnv) {
  initContentScript();
}


async function executeFullAutoTask(task: ScheduledTask) {
  console.log("[DealHunter] Executing Full-Auto hunt for task:", task);

  // 1. Ensure Floating HUD is visible to give visual real-time feedback
  injectFloatingHUD(true);

  // 2. Check platform verification block
  const block = detectPlatformBlock();
  if (block) {
    // Shown later in the task list: in the user's language
    const t = getTranslation(await storage.getLanguage().catch(() => "en" as const));
    chrome.runtime.sendMessage({
      action: MESSAGE_ACTIONS.TASK_STATUS_UPDATE,
      taskId: task.id,
      status: "failed",
      result: { result: "not_found", clicks: 0, detail: platformBlockMessage(block, t) },
    });
    return;
  }

  // 3. Delegate to unified HuntCoordinator (single source of truth for both Arm and Schedule)
  await huntCoordinator.armFromTask(task);
}

// Automatically detects if there is an active/running scheduled task for this page upon load/reload
async function checkAndResumeScheduledTasks() {
  try {
    const tasks = await storage.getTasks();
    const currentUrl = window.location.href;
    const now = Date.now();

    const activeTask = tasks.find((t) => {
      if (t.status === "completed" || t.status === "failed" || t.status === "cancelled" || t.status === "missed") return false;
      if (!isSamePageUrl(t.targetUrl, currentUrl)) return false;

      const second = t.targetSecond ?? 0;
      const targetTimestamp = t.targetAt ?? nextExactDropAt(t.targetHour, t.targetMinute, second, now);
      const preWarmMs = (t.preWarmSeconds ?? 60) * 1000;
      const untilDrop = targetTimestamp - now;
      return untilDrop <= preWarmMs && untilDrop >= -15_000;
    });

    if (activeTask) {
      console.log("[DealHunter] Found active scheduled task for this page on load/reload:", activeTask);
      executeFullAutoTask(activeTask);
    } else {
      // If no scheduled task, check if there was a manual Armed sniper session to resume across reload
      const resumed = await huntCoordinator.checkAndResumeArmedSession();
      if (resumed) {
        injectFloatingHUD(true);
      }
    }
  } catch (err) {
    console.warn("[DealHunter] Error checking scheduled tasks:", err);
  }
}

// 4. Handle messages from background or popup
if (isTopWindow() && typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === MESSAGE_ACTIONS.ACTIVATE_HUD) {
      injectFloatingHUD(true, Boolean(message.pickTarget));
      sendResponse({ success: true });
      return false;
    }

    if (message.action === MESSAGE_ACTIONS.TRIGGER_FULL_AUTO) {
      const task: ScheduledTask = message.task;
      console.log("[DealHunter] Full-Auto trigger message received for task:", task);
      sendResponse({ received: true });
      executeFullAutoTask(task);
      return false;
    }

    if (message.action === MESSAGE_ACTIONS.CANCEL_TASK) {
      // H4: the task was deleted: stop its hunt on this tab (not a manual hunt or another task's)
      const armedTaskId = huntCoordinator.getCurrentSession()?.taskId;
      const cancelled = Boolean(message.taskId) && armedTaskId === message.taskId;
      if (cancelled) huntCoordinator.disarm(false);
      sendResponse({ success: true, cancelled });
      return false;
    }

    return false;
  });
}
