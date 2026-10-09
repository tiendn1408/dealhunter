import React from "react";
import ReactDOM from "react-dom/client";
import { FloatingHUD } from "./ui/FloatingHUD";
import { PriceHistoryBadge } from "./ui/PriceHistoryBadge";
import { timeSyncClient } from "./core/time_sync_client";
import { huntCoordinator, ARMED_SESSION_KEY } from "./core/hunt_coordinator";
import { startHunt } from "./core/hunt_engine";
import { elementResolver } from "./core/element_resolver";
import { nextDropAt, nextExactDropAt } from "../lib/drop_time";
import { ScheduledTask } from "../lib/types";
import { MESSAGE_ACTIONS } from "../lib/constants";
import { storage } from "../lib/storage";
import { isSamePageUrl } from "../lib/url";
import "./ui/style.css";

function isTopWindow(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.top === window;
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
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    const hash = url.hash.toLowerCase();
    const full = (path + hash).toLowerCase();

    // 1. Core e-commerce and shopping platforms
    const isECommerceDomain =
      host.includes("shopee.") ||
      host.includes("lazada.") ||
      host.includes("tiki.vn") ||
      host.includes("tiktok.com") ||
      host.includes("sendo.vn") ||
      host.includes("amazon.") ||
      host.includes("aliexpress.") ||
      host.includes("taobao.com");

    // 2. Hub / deal paths across all e-commerce platforms
    const isDealPath =
      /\/(m|voucher|vouchers|coupon|coupons|ma-giam-gia|khuyen-mai|uu-dai|giam-gia|flash-sale|flashsale|deal|deals|campaign|super-sale|cart|checkout|gio-hang|wow|promotion)/i.test(
        full
      );

    if (isECommerceDomain && isDealPath) return true;

    // 3. Generic site with voucher or coupon path
    if (/\/(ma-giam-gia|voucher|vouchers|coupon|coupons|flash-sale|flashsale)/i.test(full)) return true;

    return false;
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
      window.dispatchEvent(new CustomEvent("dealhunter:activate-pick"));
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
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();

    // Shopee product
    if (host.includes("shopee.") && (path.includes("-i.") || path.includes("/product/"))) return true;

    // Lazada product
    if (host.includes("lazada.") && (path.includes("/products/") || path.includes("-i") || path.endsWith(".html"))) return true;

    // Tiki product
    if (host.includes("tiki.vn") && (path.includes("-p") || path.endsWith(".html"))) return true;

    // TikTok Shop product
    if (host.includes("tiktok.com") && (path.includes("/product/") || path.includes("/view/product"))) return true;

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

function initContentScript() {
  console.log("[DealHunter Assistant] Content script injected on", window.location.href);

  // 1. Initialize clock calibration
  timeSyncClient.init();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      injectFloatingHUD();
      injectPriceHistoryBadge();
      checkAndResumeScheduledTasks();
    });
  } else {
    injectFloatingHUD();
    injectPriceHistoryBadge();
    checkAndResumeScheduledTasks();
  }
}

const isTestEnv = typeof process !== "undefined" && process.env.NODE_ENV === "test";
if (isTopWindow() && !isTestEnv) {
  initContentScript();
}

/** Detects whether platform redirected away to verification, captcha, or login */
export function detectPlatformAuthOrCaptchaBlock(): string | null {
  if (typeof window === "undefined") return null;
  const host = window.location.hostname.toLowerCase();
  const path = window.location.pathname.toLowerCase();

  // Shopee
  if (host.includes("shopee.")) {
    if (path.startsWith("/verify/")) return "Shopee redirected to a verification (captcha) page - please verify and sign in before the drop";
    if (path.startsWith("/buyer/login")) return "Not signed in to Shopee in this browser";
  }

  // Lazada
  if (host.includes("lazada.")) {
    if (path.includes("/verification/") || path.includes("/punish")) return "Lazada redirected to a verification (captcha) page - please verify and sign in before the drop";
    if (path.includes("/user/login") || path.includes("/member/login")) return "Not signed in to Lazada in this browser";
  }

  // Tiki
  if (host.includes("tiki.vn")) {
    if (path.includes("/customer/account/login") || path.includes("/account/login")) return "Not signed in to Tiki in this browser";
  }

  // TikTok Shop
  if (host.includes("tiktok.com")) {
    if (path.includes("/verify") || path.includes("/security")) return "TikTok Shop requires verification - please verify and sign in before the drop";
    if (path.includes("/login")) return "Not signed in to TikTok Shop in this browser";
  }

  // Generic Captcha / Security Check
  if (path.includes("/captcha") || path.includes("/security-check")) {
    return "The website requires captcha verification - please verify and sign in first";
  }

  return null;
}

async function executeFullAutoTask(task: ScheduledTask) {
  console.log("[DealHunter] Executing Full-Auto hunt for task:", task);

  // 1. Ensure Floating HUD is visible to give visual real-time feedback
  injectFloatingHUD(true);

  // 2. Check platform verification block
  const blocked = detectPlatformAuthOrCaptchaBlock();
  if (blocked) {
    chrome.runtime.sendMessage({
      action: MESSAGE_ACTIONS.TASK_STATUS_UPDATE,
      taskId: task.id,
      status: "failed",
      result: { result: "not_found", clicks: 0, detail: blocked },
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
      const resumed = huntCoordinator.checkAndResumeArmedSession();
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
      // H4: Disarm active hunt on this tab and clean session
      huntCoordinator.disarm(false);
      try {
        sessionStorage.removeItem(ARMED_SESSION_KEY);
      } catch {
        // ignore
      }
      sendResponse({ success: true, cancelled: true });
      return false;
    }

    return false;
  });
}
