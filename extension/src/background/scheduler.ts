import { ScheduledTask } from "../lib/types";
import { storage } from "../lib/storage";
import { timeCalibrator } from "./time_calibrator";
import { MESSAGE_ACTIONS } from "../lib/constants";
import { nextDropAt } from "../lib/drop_time";

export class TaskScheduler {
  /**
   * Registers a chrome alarm for a scheduled task.
   * Alarm fires 60 seconds before target hour to allow pre-warming and calibration.
   */
  async scheduleTask(task: ScheduledTask): Promise<void> {
    await storage.addTask(task);

    const now = Date.now();
    // Drop times are Vietnam time (GMT+7) regardless of this computer's timezone
    const target = nextDropAt(task.targetHour, task.targetMinute, now, 0);

    const preWarmTime = target - 60 * 1000; // 60s in advance
    const alarmTime = Math.max(preWarmTime, now + 200);
    const alarmName = `dh_task_${task.id}`;

    chrome.alarms.create(alarmName, {
      when: alarmTime,
    });

    console.log(
      `[TaskScheduler] Task ${task.id} scheduled for pre-warm at ${new Date(alarmTime).toLocaleTimeString()}`
    );
  }

  /**
   * Handles alarm triggers from chrome.alarms.onAlarm.
   */
  async handleAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
    if (!alarm.name.startsWith("dh_task_")) return;

    const taskId = alarm.name.replace("dh_task_", "");
    const tasks = await storage.getTasks();
    const task = tasks.find((t) => t.id === taskId);

    if (!task || task.status === "cancelled") return;

    // 1. Calibrate against Shopee's clock right before the drop (stored for the content script)
    await timeCalibrator.calibrate(5);

    // 2. Open or focus target tab
    const tab = await chrome.tabs.create({
      url: task.targetUrl,
      active: true,
    });

    await storage.updateTaskStatus(taskId, "running");

    // 3. Wait for tab to load and send FULL_AUTO_HUNT message
    if (tab.id) {
      const tabId = tab.id;
      const checkInterval = setInterval(async () => {
        try {
          const updatedTab = await chrome.tabs.get(tabId);
          if (updatedTab.status === "complete") {
            clearInterval(checkInterval);
            // Tab loaded, dispatch trigger message
            chrome.tabs.sendMessage(tabId, {
              action: MESSAGE_ACTIONS.TRIGGER_FULL_AUTO,
              task,
            });
          }
        } catch {
          clearInterval(checkInterval);
        }
      }, 500);
    }
  }

  async cancelTask(taskId: string): Promise<void> {
    await chrome.alarms.clear(`dh_task_${taskId}`);
    await storage.removeTask(taskId);
  }
}

export const taskScheduler = new TaskScheduler();
