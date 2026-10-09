import { ScheduledTask } from "../lib/types";
import { storage } from "../lib/storage";
import { timeCalibrator } from "./time_calibrator";
import { MESSAGE_ACTIONS } from "../lib/constants";
import { nextExactDropAt } from "../lib/drop_time";

export class TaskScheduler {
  constructor() {
    this.setupTabReloadListener();
  }

  private setupTabReloadListener(): void {
    if (typeof chrome === "undefined" || !chrome.tabs?.onUpdated) return;

    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (changeInfo.status !== "complete" || !tab.url) return;

      try {
        const tasks = await storage.getTasks();
        const now = Date.now();
        const activeTask = tasks.find((t) => {
          if (t.status !== "running") return false;
          try {
            const u1 = new URL(t.targetUrl);
            const u2 = new URL(tab.url!);
            if (u1.origin !== u2.origin || u1.pathname !== u2.pathname) return false;
          } catch {
            if (t.targetUrl !== tab.url) return false;
          }
          const second = t.targetSecond ?? 0;
          const targetTimestamp = nextExactDropAt(t.targetHour, t.targetMinute, second, now);
          const untilDrop = targetTimestamp - now;
          return untilDrop <= (t.preWarmSeconds ?? 60) * 1000 && untilDrop >= -10_000;
        });

        if (activeTask) {
          console.log(`[TaskScheduler] Tab ${tabId} reloaded while task ${activeTask.id} is active. Re-dispatching trigger!`);
          chrome.tabs.sendMessage(tabId, {
            action: MESSAGE_ACTIONS.TRIGGER_FULL_AUTO,
            task: activeTask,
          }).catch((err) => console.warn("[TaskScheduler] Re-dispatch failed:", err));
        }
      } catch {
        // ignore
      }
    });
  }

  /**
   * Registers a chrome alarm for a scheduled task.
   * Alarm fires before target drop time to allow pre-warming and domain calibration.
   */
  async scheduleTask(task: ScheduledTask): Promise<void> {
    await storage.addTask(task);

    const now = Date.now();
    const second = task.targetSecond ?? 0;
    // Calculate target timestamp in Vietnam wall clock (GMT+7)
    const target = nextExactDropAt(task.targetHour, task.targetMinute, second, now);

    const preWarmMs = (task.preWarmSeconds ?? 60) * 1000;
    const preWarmTime = target - preWarmMs;
    const alarmTime = Math.max(preWarmTime, now + 500);
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

    // 1. Resolve descriptor from saved page targets if not directly set
    if (!task.descriptor) {
      try {
        const saved = await storage.getSavedTargetForUrl(task.targetUrl);
        if (saved) {
          task.descriptor = saved.descriptor;
          task.savedTargetId = saved.id;
          if (typeof task.dualDefenseReload !== "boolean" && typeof saved.dualDefenseReload === "boolean") {
            task.dualDefenseReload = saved.dualDefenseReload;
          }
        }
      } catch {
        // ignore
      }
    }

    // 2. Calibrate clock against the specific target page's server
    try {
      const targetOrigin = new URL(task.targetUrl).origin;
      await timeCalibrator.calibrate(3, 4000, `${targetOrigin}/favicon.ico`);
    } catch {
      await timeCalibrator.calibrate(3);
    }

    // 3. Check if target tab is already open — reuse and focus rather than spamming duplicate tabs
    let targetTab: chrome.tabs.Tab | null = null;
    try {
      const allTabs = await chrome.tabs.query({});
      const targetUrlObj = new URL(task.targetUrl);
      targetTab =
        allTabs.find((t) => {
          if (!t.url) return false;
          try {
            const u = new URL(t.url);
            return u.origin === targetUrlObj.origin && u.pathname === targetUrlObj.pathname;
          } catch {
            return t.url === task.targetUrl;
          }
        }) || null;
    } catch {
      targetTab = null;
    }

    let tabId: number;
    let isNewTab = false;

    if (targetTab?.id) {
      tabId = targetTab.id;
      // Focus existing tab and bring its window to front
      await chrome.tabs.update(tabId, { active: true });
      if (targetTab.windowId) {
        try {
          await chrome.windows.update(targetTab.windowId, { focused: true });
        } catch {
          // ignore
        }
      }

      const second = task.targetSecond ?? 0;
      const targetTimestamp = nextExactDropAt(task.targetHour, task.targetMinute, second, Date.now());
      const untilDrop = targetTimestamp - Date.now();

      // If existing tab was already open and we have plenty of lead time (>= 20s), reload it to clear stale session/DOM
      if (untilDrop >= 20_000) {
        console.log(`[TaskScheduler] Pre-warming existing tab ${tabId} with fresh reload (T-${Math.round(untilDrop / 1000)}s)`);
        if (typeof chrome.tabs?.reload === "function") {
          await chrome.tabs.reload(tabId);
        }
      }
    } else {
      isNewTab = true;
      const created = await chrome.tabs.create({
        url: task.targetUrl,
        active: true,
      });
      if (!created.id) return;
      tabId = created.id;
    }

    await storage.updateTaskStatus(taskId, "running");

    // 4. Send trigger message with full descriptor snapshot
    const dispatchTrigger = () => {
      chrome.tabs.sendMessage(tabId, {
        action: MESSAGE_ACTIONS.TRIGGER_FULL_AUTO,
        task,
      }).catch(() => {
        // If content script was still initializing, retry dispatch once after 1s
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, {
            action: MESSAGE_ACTIONS.TRIGGER_FULL_AUTO,
            task,
          }).catch((err) => console.warn("[TaskScheduler] Dispatch retry failed:", err));
        }, 1000);
      });
    };

    if (!isNewTab && targetTab?.status === "complete" && !targetTab.discarded) {
      // Existing tab is already active and fully rendered, dispatch immediately
      dispatchTrigger();
    } else {
      // New or loading tab: poll until status === "complete" (max 15s)
      const startTime = Date.now();
      const checkInterval = setInterval(async () => {
        try {
          const updatedTab = await chrome.tabs.get(tabId);
          if (updatedTab.status === "complete" || Date.now() - startTime > 15000) {
            clearInterval(checkInterval);
            dispatchTrigger();
          }
        } catch {
          clearInterval(checkInterval);
        }
      }, 400);
    }
  }

  async cancelTask(taskId: string): Promise<void> {
    await chrome.alarms.clear(`dh_task_${taskId}`);
    await storage.removeTask(taskId);
  }
}

export const taskScheduler = new TaskScheduler();
