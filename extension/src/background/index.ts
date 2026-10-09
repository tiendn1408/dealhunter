import { timeCalibrator } from "./time_calibrator";
import { taskScheduler } from "./scheduler";
import { MESSAGE_ACTIONS } from "../lib/constants";
import { storage } from "../lib/storage";
import { webSession } from "./web_session";
import { apiClient, SessionRejectedError } from "../lib/api_client";
import { PriceContextResponse } from "../lib/types";
import { isValidHttpUrl } from "../lib/url";

// 1. Listen for extension install / update and browser startup (H1)
chrome.runtime.onInstalled.addListener(async () => {
  console.log("[DealHunter ServiceWorker] Extension installed / updated");
  await taskScheduler.restorePendingAlarms();
  await timeCalibrator.calibrate(3);
});

chrome.runtime.onStartup.addListener(async () => {
  console.log("[DealHunter ServiceWorker] Browser startup");
  await taskScheduler.restorePendingAlarms();
});

// 2. Listen for alarm triggers (Full-Auto scheduled hunts)
chrome.alarms.onAlarm.addListener((alarm) => {
  taskScheduler.handleAlarm(alarm);
});

// 3. Message dispatcher across components
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // P4: Validate message sender belongs to this extension
  if (sender.id && sender.id !== chrome.runtime.id) {
    return false;
  }

  if (message.action === MESSAGE_ACTIONS.CALIBRATE_TIME) {
    if (message.targetUrl && !isValidHttpUrl(message.targetUrl)) {
      sendResponse({ success: false, error: "Invalid target URL scheme. Only HTTP and HTTPS are permitted." });
      return true;
    }
    timeCalibrator
      .calibrate(message.samples || 5, 6000, message.targetUrl)
      .then((cal) => sendResponse({ success: true, calibration: cal }))
      .catch((err) => sendResponse({ success: false, error: (err as Error).message }));
    return true; // Keep message channel open for async response
  }

  if (message.action === MESSAGE_ACTIONS.GET_CALIBRATION) {
    storage
      .getCalibration(message.domain)
      .then((cal) => sendResponse({ calibration: cal }))
      .catch((err) => sendResponse({ calibration: null, error: (err as Error).message }));
    return true;
  }

  if (message.action === MESSAGE_ACTIONS.TASK_STATUS_UPDATE) {
    if (message.taskId && message.status) {
      if (message.status !== "running") {
        taskScheduler.clearRunningTab(message.taskId);
      }
      const lastResult = message.result ? { ...message.result, finishedAt: Date.now() } : undefined;
      storage
        .updateTaskStatus(message.taskId, message.status, lastResult)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: (err as Error).message }));
      return true;
    }
  }

  if (message.action === MESSAGE_ACTIONS.SCHEDULE_TASK) {
    if (message.task) {
      if (!isValidHttpUrl(message.task.targetUrl)) {
        sendResponse({ success: false, error: "Invalid task URL scheme. Only HTTP and HTTPS are permitted." });
        return true;
      }
      taskScheduler
        .scheduleTask(message.task)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: (err as Error).message }));
      return true;
    }
  }

  if (message.action === MESSAGE_ACTIONS.CANCEL_TASK) {
    if (message.taskId) {
      taskScheduler
        .cancelTask(message.taskId)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: (err as Error).message }));
      return true;
    }
  }

  if (message.action === MESSAGE_ACTIONS.GET_PRICE_CONTEXT) {
    getPriceContext(String(message.url || ""))
      .then(sendResponse)
      .catch((err) => sendResponse({ signedIn: false, error: (err as Error).message }));
    return true;
  }

  if (message.action === MESSAGE_ACTIONS.GET_WEB_SESSION) {
    webSession
      .get()
      .then((session) => {
        // The popup only needs who is signed in, never the token
        sendResponse(session ? { signedIn: true, email: session.email, name: session.name } : { signedIn: false });
      })
      .catch((err) => sendResponse({ signedIn: false, error: (err as Error).message }));
    return true;
  }

  return false;
});

// 4. Sign-in session pushed by the DealHunter web app (see web_session.ts)
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  webSession.handleExternalMessage(message, sender.origin).then((accepted) => sendResponse({ accepted }));
  return true;
});

/** Price context for the product page, only for a member signed in to DealHunter web. */
async function getPriceContext(url: string): Promise<PriceContextResponse> {
  const session = await webSession.get();
  if (!session) return { signedIn: false };
  try {
    const context = await apiClient.getProductPriceContext(url, session);
    // Links go to the web app that sent this session (else the last known / default web URL)
    const webUrl = session.webUrl ?? (await storage.getEndpoints()).webUrl;
    return { signedIn: true, context, webUrl };
  } catch (err) {
    if (err instanceof SessionRejectedError) {
      await webSession.clear();
      return { signedIn: false };
    }
    console.warn("[DealHunter] Price context unavailable:", err);
    return { signedIn: false };
  }
}



