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
import "./ui/style.css";

console.log("[DealHunter Assistant] Content script injected on", window.location.href);

// 1. Initialize clock calibration
timeSyncClient.init();

// 2. Inject Floating HUD on voucher/campaign/cart pages or pages with a saved target / scheduled task / armed session
async function injectFloatingHUD(force = false, autoPick = false) {
  const isVoucherPage =
    window.location.href.includes("/m/ma-giam-gia") ||
    window.location.href.includes("/m/10-10") ||
    window.location.href.includes("/m/11-11") ||
    window.location.href.includes("/m/") ||
    window.location.href.includes("/cart");

  let hasSavedTarget = false;
  let hasScheduledTask = false;
  let hasArmedSession = false;

  try {
    const raw = sessionStorage.getItem(ARMED_SESSION_KEY);
    if (raw) {
      const sess = JSON.parse(raw);
      if (sess.url === window.location.href) {
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
          if (t.status === "completed" || t.status === "failed" || t.status === "cancelled") return false;
          try {
            const u1 = new URL(t.targetUrl);
            const u2 = new URL(currentUrl);
            return u1.origin === u2.origin && u1.pathname === u2.pathname;
          } catch {
            return t.targetUrl === currentUrl;
          }
        });
      } catch {
        // ignore
      }
    }
  }

  if (!force && !isVoucherPage && !hasSavedTarget && !hasScheduledTask && !hasArmedSession) return;
  if (document.getElementById("dealhunter-hud-root")) return;

  const container = document.createElement("div");
  container.id = "dealhunter-hud-root";
  document.body.appendChild(container);

  const root = ReactDOM.createRoot(container);
  root.render(<FloatingHUD onClose={() => container.remove()} hostElement={container} autoPick={autoPick} />);
}

// 3. Inject Price History Badge on product pages
function injectPriceHistoryBadge() {
  const isProductPage =
    window.location.href.includes("-i.") || window.location.href.includes("/product/");

  if (!isProductPage) return;
  if (document.getElementById("dealhunter-badge-root")) return;

  const container = document.createElement("div");
  container.id = "dealhunter-badge-root";
  document.body.appendChild(container);

  const root = ReactDOM.createRoot(container);
  root.render(<PriceHistoryBadge />);
}

// Initialize injections and auto-resume scheduled tasks
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

/** Why this tab cannot hunt, if Shopee redirected it away from the voucher page. */
function shopeeBlockReason(): string | null {
  if (!window.location.hostname.includes("shopee.")) return null;
  const path = window.location.pathname;
  if (path.startsWith("/verify/")) return "Shopee redirected to a verification (captcha) page - open Shopee, verify and sign in before the drop";
  if (path.startsWith("/buyer/login")) return "Not signed in to Shopee in this browser";
  return null;
}

async function executeFullAutoTask(task: ScheduledTask) {
  console.log("[DealHunter] Executing Full-Auto hunt for task:", task);

  // 1. Ensure Floating HUD is visible to give visual real-time feedback
  injectFloatingHUD(true);

  // 2. Check Shopee verification block if on Shopee
  const blocked = shopeeBlockReason();
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
      if (t.status === "completed" || t.status === "failed" || t.status === "cancelled") return false;
      const urlMatches = (() => {
        try {
          const u1 = new URL(t.targetUrl);
          const u2 = new URL(currentUrl);
          return u1.origin === u2.origin && u1.pathname === u2.pathname;
        } catch {
          return t.targetUrl === currentUrl;
        }
      })();
      if (!urlMatches) return false;

      const second = t.targetSecond ?? 0;
      const targetTimestamp = nextExactDropAt(t.targetHour, t.targetMinute, second, now);
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

  return false;
});
