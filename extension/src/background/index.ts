import { timeCalibrator } from "./time_calibrator";
import { taskScheduler } from "./scheduler";
import { MESSAGE_ACTIONS } from "../lib/constants";
import { storage } from "../lib/storage";
import { webSession } from "./web_session";
import { apiClient, SessionRejectedError } from "../lib/api_client";
import { PriceContextResponse } from "../lib/types";

// 1. Listen for extension install / update
chrome.runtime.onInstalled.addListener(async () => {
  console.log("[DealHunter ServiceWorker] Extension installed / updated");
  // Run initial clock calibration
  await timeCalibrator.calibrate(3);
});

// 2. Listen for alarm triggers (Full-Auto scheduled hunts)
chrome.alarms.onAlarm.addListener((alarm) => {
  taskScheduler.handleAlarm(alarm);
});

// 3. Message dispatcher across components
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === MESSAGE_ACTIONS.CALIBRATE_TIME) {
    timeCalibrator.calibrate(message.samples || 5).then((cal) => {
      sendResponse({ success: true, calibration: cal });
    });
    return true; // Keep message channel open for async response
  }

  if (message.action === MESSAGE_ACTIONS.GET_CALIBRATION) {
    storage.getCalibration().then((cal) => {
      sendResponse({ calibration: cal });
    });
    return true;
  }

  if (message.action === MESSAGE_ACTIONS.TASK_STATUS_UPDATE) {
    if (message.taskId && message.status) {
      const lastResult = message.result ? { ...message.result, finishedAt: Date.now() } : undefined;
      storage.updateTaskStatus(message.taskId, message.status, lastResult).then(() => {
        sendResponse({ success: true });
      });
      return true;
    }
  }

  if (message.action === MESSAGE_ACTIONS.GET_PRICE_CONTEXT) {
    getPriceContext(String(message.url || "")).then(sendResponse);
    return true;
  }

  if (message.action === MESSAGE_ACTIONS.GET_WEB_SESSION) {
    webSession.get().then((session) => {
      // The popup only needs who is signed in, never the token
      sendResponse(session ? { signedIn: true, email: session.email, name: session.name } : { signedIn: false });
    });
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
    const context = await apiClient.getProductPriceContext(url, session.accessToken);
    const { webUrl } = await storage.getEndpoints();
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
