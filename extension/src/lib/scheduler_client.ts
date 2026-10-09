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

export async function cancelTaskViaBackground(taskId: string): Promise<void> {
  const response = await chrome.runtime.sendMessage({
    action: MESSAGE_ACTIONS.CANCEL_TASK,
    taskId,
  });
  if (response && response.success === false) {
    throw new Error(response.error || "Failed to cancel task");
  }
}
