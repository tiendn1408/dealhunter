import React from "react";
import ReactDOM from "react-dom/client";
import { FloatingHUD } from "./ui/FloatingHUD";
import { PriceHistoryBadge } from "./ui/PriceHistoryBadge";
import { timeSyncClient } from "./core/time_sync_client";
import { startHunt } from "./core/hunt_engine";
import { nextDropAt } from "../lib/drop_time";
import { ScheduledTask } from "../lib/types";
import { MESSAGE_ACTIONS } from "../lib/constants";
import "./ui/style.css";

console.log("[DealHunter Assistant] Content script injected on", window.location.href);

// 1. Initialize clock calibration
timeSyncClient.init();

// 2. Inject Floating HUD on voucher/campaign/cart pages
function injectFloatingHUD(force = false) {
  const isVoucherPage =
    window.location.href.includes("/m/ma-giam-gia") ||
    window.location.href.includes("/m/10-10") ||
    window.location.href.includes("/m/11-11") ||
    window.location.href.includes("/m/") ||
    window.location.href.includes("/cart");

  if (!force && !isVoucherPage) return;
  if (document.getElementById("dealhunter-hud-root")) return;

  const container = document.createElement("div");
  container.id = "dealhunter-hud-root";
  document.body.appendChild(container);

  const root = ReactDOM.createRoot(container);
  root.render(<FloatingHUD onClose={() => container.remove()} />);
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

// Initialize injections
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    injectFloatingHUD();
    injectPriceHistoryBadge();
  });
} else {
  injectFloatingHUD();
  injectPriceHistoryBadge();
}

/** Why this tab cannot hunt, if Shopee redirected it away from the voucher page. */
function shopeeBlockReason(): string | null {
  const path = window.location.pathname;
  if (path.startsWith("/verify/")) return "Shopee redirected to a verification (captcha) page - open Shopee, verify and sign in before the drop";
  if (path.startsWith("/buyer/login")) return "Not signed in to Shopee in this browser";
  return null;
}

// 4. Handle messages from background or popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === MESSAGE_ACTIONS.ACTIVATE_HUD) {
    injectFloatingHUD(true);
    sendResponse({ success: true });
    return false;
  }

  if (message.action !== MESSAGE_ACTIONS.TRIGGER_FULL_AUTO) return false;

  const task: ScheduledTask = message.task;
  console.log("[DealHunter] Full-Auto hunt armed for task:", task);
  sendResponse({ received: true });

  (async () => {
    // Shopee may send the tab to a captcha/verification or login page instead of the voucher page
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

    // The background calibrated right before opening this tab; load that calibration first
    await timeSyncClient.init();
    const targetTimestamp = nextDropAt(task.targetHour, task.targetMinute, timeSyncClient.getShopeeTime());

    startHunt({
      targetTimestamp,
      now: () => timeSyncClient.getShopeeTime(),
      keyword: task.keyword,
      onStatus: (msg) => console.log("[DealHunter Full-Auto]", msg),
      onDone: (outcome) => {
        console.log("[DealHunter Full-Auto] Result:", outcome);
        chrome.runtime.sendMessage({
          action: MESSAGE_ACTIONS.TASK_STATUS_UPDATE,
          taskId: task.id,
          status: outcome.result === "saved" ? "completed" : "failed",
          result: outcome,
        });
      },
    });
  })();

  return false;
});
