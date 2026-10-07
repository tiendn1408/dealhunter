import React from "react";
import ReactDOM from "react-dom/client";
import { FloatingHUD } from "./ui/FloatingHUD";
import { PriceHistoryBadge } from "./ui/PriceHistoryBadge";
import { timeSyncClient } from "./core/time_sync_client";
import { elementResolver } from "./core/element_resolver";
import { humanClicker } from "./core/human_clicker";
import { MESSAGE_ACTIONS } from "../lib/constants";
import "./ui/style.css";

console.log("[DealHunter Assistant] Content script injected on", window.location.href);

// 1. Initialize clock calibration
timeSyncClient.init();

// 2. Inject Floating HUD on voucher/campaign/cart pages
function injectFloatingHUD() {
  const isVoucherPage =
    window.location.href.includes("/m/ma-giam-gia") ||
    window.location.href.includes("/m/10-10") ||
    window.location.href.includes("/m/11-11") ||
    window.location.href.includes("/m/") ||
    window.location.href.includes("/cart");

  if (!isVoucherPage) return;
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

// 4. Handle Full-Auto Hunt message from background service worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === MESSAGE_ACTIONS.TRIGGER_FULL_AUTO) {
    console.log("[DealHunter] Full-Auto hunt triggered for task:", message.task);

    // Calculate exact target timestamp
    const task = message.task;
    const now = timeSyncClient.getShopeeTime();
    const targetDate = new Date(now);
    targetDate.setHours(task.targetHour, task.targetMinute, 0, 0);
    if (targetDate.getTime() < now - 5000) {
      targetDate.setDate(targetDate.getDate() + 1);
    }
    const targetTimestamp = targetDate.getTime();

    const checkTargetReady = setInterval(() => {
      const currentShopeeTime = timeSyncClient.getShopeeTime();
      const diff = targetTimestamp - currentShopeeTime;

      // Exact trigger window: within 80ms before 00.000s up to 1500ms after
      if (diff <= 80 && diff >= -1500) {
        clearInterval(checkTargetReady);

        const buttons = elementResolver.findCollectButtons(task?.keyword);
        if (buttons.length > 0) {
          console.log("[DealHunter Full-Auto] Firing turbo burst on target button!");
          humanClicker.startBurst(
            buttons[0],
            35,
            2000,
            () => elementResolver.isButtonFinished(buttons[0]),
            (success) => {
              chrome.runtime.sendMessage({
                action: MESSAGE_ACTIONS.TASK_STATUS_UPDATE,
                taskId: task.id,
                status: success ? "completed" : "completed",
              });
            }
          );
        }
      }
    }, 20);

    sendResponse({ received: true });
    return true;
  }
  return false;
});
