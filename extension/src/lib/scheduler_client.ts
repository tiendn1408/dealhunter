import { ScheduledTask } from "./types";
import { MESSAGE_ACTIONS } from "./constants";

/**
 * Lightweight client for popup and UI components to manage scheduled tasks
 * via background service worker messages, avoiding importing the full TaskScheduler
 * and creating duplicate event listeners in non-background contexts (M18).
 */
export async function scheduleTaskViaBackground(task: ScheduledTask): Promise<void> {
  const response = await chrome.runtime.sendMessage({
    action: MESSAGE_ACTIONS.SCHEDULE_TASK,
    task,
  });
  if (response && response.success === false) {
    throw new Error(response.error || "Failed to schedule task");
  }
}

/** Saves changes to a scheduled hunt (time, button, every day, refresh); its alarm is reset. */
export async function updateTaskViaBackground(task: ScheduledTask): Promise<void> {
  const response = await chrome.runtime.sendMessage({ action: MESSAGE_ACTIONS.UPDATE_TASK, task });
  if (response && response.success === false) {
    throw new Error(response.error || "Failed to update task");
  }
}

/** Opens (or focuses) a page and starts "pick a button" there, to change the button of its hunts. */
export async function openAndPickViaBackground(url: string): Promise<void> {
  await chrome.runtime.sendMessage({ action: MESSAGE_ACTIONS.OPEN_AND_PICK, url });
}

export async function cancelTaskViaBackground(taskId: string): Promise<void> {
  const response = await chrome.runtime.sendMessage({
    action: MESSAGE_ACTIONS.CANCEL_TASK,
    taskId,
  });
  if (response && response.success === false) {
    throw new Error(response.error || "Failed to cancel task");
  }
}
