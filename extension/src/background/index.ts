import { timeCalibrator } from "./time_calibrator";
import { taskScheduler } from "./scheduler";
import { MESSAGE_ACTIONS } from "../lib/constants";
import { storage } from "../lib/storage";

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
      storage.updateTaskStatus(message.taskId, message.status).then(() => {
        sendResponse({ success: true });
      });
      return true;
    }
  }

  return false;
});
