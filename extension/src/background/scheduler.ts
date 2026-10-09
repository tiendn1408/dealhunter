import { ScheduledTask } from "../lib/types";
import { storage } from "../lib/storage";
import { timeCalibrator } from "./time_calibrator";
import { MESSAGE_ACTIONS } from "../lib/constants";
import { nextExactDropAt } from "../lib/drop_time";
import { isSamePageUrl } from "../lib/url";

export class TaskScheduler {
  private runningTabTasks: Map<number, string> = new Map();

  constructor() {
    this.setupTabReloadListener();
    this.setupTabRemovedListener();
  }

  setupTabRemovedListener(): void {
    if (typeof chrome === "undefined" || !chrome.tabs?.onRemoved) return;

    chrome.tabs.onRemoved.addListener(async (tabId) => {
      const taskId = this.runningTabTasks.get(tabId);
      if (!taskId) return;
      this.runningTabTasks.delete(tabId);

      try {
        const tasks = await storage.getTasks();
        const task = tasks.find((t) => t.id === taskId);
        if (task && task.status === "running") {
          console.warn(`[TaskScheduler] Tab ${tabId} closed while task ${taskId} was active. Marking failed!`);
          await storage.updateTaskStatus(taskId, "failed", {
            result: "not_found",
            clicks: 0,
            detail: "Target tab was closed before drop",
            finishedAt: Date.now(),
          });
        }
      } catch {
        // ignore
      }
    });
  }

  clearRunningTab(taskId: string): void {
    for (const [tabId, id] of this.runningTabTasks.entries()) {
      if (id === taskId) {
        this.runningTabTasks.delete(tabId);
      }
    }
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
          if (!isSamePageUrl(t.targetUrl, tab.url!)) return false;

          const second = t.targetSecond ?? 0;
          const targetTimestamp = t.targetAt ?? nextExactDropAt(t.targetHour, t.targetMinute, second, now);
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
   * Restores alarms for all pending tasks on browser startup / extension reload (H1).
   * Expired tasks beyond grace deadline are marked missed (H2/H3).
   */
  async restorePendingAlarms(): Promise<void> {
    const tasks = await storage.getTasks();
    const now = Date.now();
    for (const task of tasks) {
      if (task.status === "pending" || task.status === "running") {
        const second = task.targetSecond ?? 0;
        const target = task.targetAt ?? nextExactDropAt(task.targetHour, task.targetMinute, second, now);
        task.targetAt = target;

        if (now > target + 15_000) {
          console.warn(`[TaskScheduler] Task ${task.id} expired during downtime. Marking missed!`);
          await storage.updateTaskStatus(task.id, "missed", {
            result: "timeout",
            clicks: 0,
            detail: "Drop deadline expired during browser/extension downtime",
            finishedAt: now,
          });
        } else {
          const preWarmMs = (task.preWarmSeconds ?? 60) * 1000;
          const preWarmTime = target - preWarmMs;
          const alarmTime = Math.max(preWarmTime, now + 500);
          const alarmName = `dh_task_${task.id}`;
          chrome.alarms.create(alarmName, { when: alarmTime });
          console.log(`[TaskScheduler] Restored alarm for task ${task.id} at ${new Date(alarmTime).toLocaleTimeString()}`);
        }
      }
    }
  }

  /**
   * Registers a chrome alarm for a scheduled task.
   * Alarm fires before target drop time to allow pre-warming and domain calibration.
   */
  async scheduleTask(task: ScheduledTask): Promise<void> {
    const now = Date.now();
    const second = task.targetSecond ?? 0;
    // Calculate and lock absolute target drop timestamp (H2)
    const target = task.targetAt ?? nextExactDropAt(task.targetHour, task.targetMinute, second, now);
    task.targetAt = target;

    await storage.addTask(task);

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

    if (!task || task.status === "cancelled" || task.status === "completed" || task.status === "missed") return;

    const now = Date.now();
    const second = task.targetSecond ?? 0;
    const targetTimestamp = task.targetAt ?? nextExactDropAt(task.targetHour, task.targetMinute, second, now);
    task.targetAt = targetTimestamp;

    // H2 / H3: If the alarm triggered past drop deadline grace window (15s), mark missed and abort!
    if (now > targetTimestamp + 15_000) {
      console.warn(`[TaskScheduler] Task ${task.id} alarm fired past drop deadline. Marking missed.`);
      await storage.updateTaskStatus(taskId, "missed", {
        result: "timeout",
        clicks: 0,
        detail: "Drop deadline expired before alarm triggered (device asleep or off)",
        finishedAt: now,
      });
      return;
    }

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

    // 3. Check if target tab is already open — reuse and focus rather than spamming duplicate tabs (H7)
    let targetTab: chrome.tabs.Tab | null = null;
    try {
      const allTabs = await chrome.tabs.query({});
      targetTab = allTabs.find((t) => t.url && isSamePageUrl(t.url, task.targetUrl)) || null;
    } catch {
      targetTab = null;
    }

    let tabId: number;
    let isNewTab = false;
    let tabReloadPromise: Promise<void> | null = null;

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

      const untilDrop = targetTimestamp - Date.now();

      // If existing tab was already open and we have plenty of lead time (>= 20s), reload it to clear stale session/DOM
      if (untilDrop >= 20_000) {
        console.log(`[TaskScheduler] Pre-warming existing tab ${tabId} with fresh reload (T-${Math.round(untilDrop / 1000)}s)`);
        if (typeof chrome.tabs?.reload === "function") {
          // M2: Wait for tab reload complete via onUpdated before dispatching trigger
          tabReloadPromise = new Promise<void>((resolve) => {
            let done = false;
            const finish = () => {
              if (!done) {
                done = true;
                if (typeof chrome !== "undefined" && chrome.tabs?.onUpdated?.removeListener) {
                  try {
                    chrome.tabs.onUpdated.removeListener(listener);
                  } catch {}
                }
                clearTimeout(fallbackTimer);
                resolve();
              }
            };
            const listener = (updatedId: number, info: { status?: string }) => {
              if (updatedId === tabId && info.status === "complete") {
                finish();
              }
            };
            if (typeof chrome !== "undefined" && chrome.tabs?.onUpdated?.addListener) {
              chrome.tabs.onUpdated.addListener(listener);
            }
            const fallbackTimer = setTimeout(finish, 10000);
          });
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
    this.runningTabTasks.set(tabId, taskId);

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

    if (tabReloadPromise) {
      await tabReloadPromise;
      dispatchTrigger();
    } else if (!isNewTab && targetTab?.status === "complete" && !targetTab.discarded) {
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
    this.clearRunningTab(taskId);
    await chrome.alarms.clear(`dh_task_${taskId}`);
    const tasks = await storage.getTasks();
    const task = tasks.find((t) => t.id === taskId);
    await storage.removeTask(taskId);

    // H4: Notify matching open tabs to disarm and clear session
    if (task && typeof chrome !== "undefined" && chrome.tabs?.query) {
      try {
        const allTabs = await chrome.tabs.query({});
        for (const t of allTabs) {
          if (t.id && t.url && isSamePageUrl(t.url, task.targetUrl)) {
            chrome.tabs.sendMessage(t.id, {
              action: MESSAGE_ACTIONS.CANCEL_TASK,
              taskId,
            }).catch(() => {});
          }
        }
      } catch {
        // ignore
      }
    }
  }
}

export const taskScheduler = new TaskScheduler();
