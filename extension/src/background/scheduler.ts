import { ScheduledTask } from "../lib/types";
import { storage } from "../lib/storage";
import { timeCalibrator } from "./time_calibrator";
import { MESSAGE_ACTIONS } from "../lib/constants";
import { nextExactDropAt } from "../lib/drop_time";
import { isSamePageUrl } from "../lib/url";

/** Outcomes after which a daily task moves on to its next drop. */
const ROLL_OVER_STATUSES = new Set<ScheduledTask["status"]>(["completed", "failed", "missed", "cancelled"]);

/**
 * The drop a task was created for: the first HH:mm:ss after it was created. For tasks saved before
 * targetAt existed; without createdAt the next one from now.
 */
function firstDropAt(task: ScheduledTask, now = Date.now()): number {
  return nextExactDropAt(task.targetHour, task.targetMinute, task.targetSecond ?? 0, task.createdAt ?? now);
}

/** Moves a daily task to its next drop, strictly after the current one (and at least a minute ahead). */
function rollDailyTask(task: ScheduledTask, now: number, lastResult?: ScheduledTask["lastResult"]): void {
  const after = Math.max(now, task.targetAt ?? now) + 60_000;
  task.targetAt = nextExactDropAt(task.targetHour, task.targetMinute, task.targetSecond ?? 0, after);
  task.status = "pending";
  if (lastResult) task.lastResult = lastResult;
}

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
          await this.handleTaskStatusUpdate(taskId, "failed", {
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

  /**
   * Records a task result. A daily task moves on to its next drop instead (any outcome, including a
   * disarm: that skips today only). Unknown tasks (deleted meanwhile) are ignored.
   */
  async handleTaskStatusUpdate(
    taskId: string,
    status: ScheduledTask["status"],
    lastResult?: ScheduledTask["lastResult"]
  ): Promise<void> {
    if (status !== "running") {
      this.clearRunningTab(taskId);
    }

    const rolled = await storage.mutateTasks((tasks) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return null;
      if (task.isDaily && ROLL_OVER_STATUSES.has(status)) {
        rollDailyTask(task, Date.now(), lastResult);
        return task;
      }
      task.status = status;
      if (lastResult) task.lastResult = lastResult;
      return null;
    });

    if (rolled) {
      this.createAlarm(rolled, Date.now());
      console.log(
        `[TaskScheduler] Daily task ${rolled.id} rolled over to next drop at ${new Date(rolled.targetAt!).toLocaleString()}`
      );
    }
  }

  /** Alarm for a task: its pre-warm time before the drop (at least slightly in the future). */
  private createAlarm(task: ScheduledTask, now: number): void {
    const preWarmMs = (task.preWarmSeconds ?? 60) * 1000;
    chrome.alarms.create(`dh_task_${task.id}`, { when: Math.max(task.targetAt! - preWarmMs, now + 500) });
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
   * Brings every task in line with the clock, on browser startup / extension reload (H1) and
   * periodically (watchdog: a result can be lost when the service worker is stopped mid-hunt):
   * - pending past its drop (+15 s grace) or running past it (+60 s: the hunt is surely over):
   *   a daily task moves on to its next drop, a one-off task is marked missed (H2/H3);
   * - a pending task without an alarm gets one back. An existing alarm is left alone, so a task
   *   about to fire is not triggered twice.
   * One write for the whole pass, so no task's update overwrites another's.
   */
  async restorePendingAlarms(): Promise<void> {
    const now = Date.now();
    const toAlarm = await storage.mutateTasks((tasks) => {
      const out: ScheduledTask[] = [];
      for (const task of tasks) {
        if (task.status !== "pending" && task.status !== "running") continue;
        task.targetAt = task.targetAt ?? firstDropAt(task);
        const grace = task.status === "running" ? 60_000 : 15_000;

        if (now > task.targetAt + grace) {
          const detail =
            task.status === "running"
              ? "The hunt's result never came back (tab closed or browser stopped)"
              : "Drop deadline expired during browser/extension downtime";
          const lastResult = { result: "timeout" as const, clicks: 0, detail, finishedAt: now };
          if (task.isDaily) {
            rollDailyTask(task, now, lastResult);
            out.push(task);
          } else {
            task.status = "missed";
            task.lastResult = lastResult;
          }
        } else if (task.status === "pending") {
          out.push(task);
        }
      }
      return out;
    });

    for (const task of toAlarm) {
      const name = `dh_task_${task.id}`;
      const existing = typeof chrome.alarms.get === "function" ? await chrome.alarms.get(name) : undefined;
      if (existing) continue;
      this.createAlarm(task, now);
      console.log(`[TaskScheduler] Restored alarm for task ${task.id} (drop ${new Date(task.targetAt!).toLocaleString()})`);
    }
  }

  /**
   * Registers a chrome alarm for a scheduled task.
   * Alarm fires before target drop time to allow pre-warming and domain calibration.
   */
  /**
   * Schedules a hunt. The same page at the same time already waiting is updated instead of being
   * added twice. Returns the task as stored (its id is the existing one when updated).
   */
  async scheduleTask(task: ScheduledTask): Promise<ScheduledTask> {
    const now = Date.now();
    const second = task.targetSecond ?? 0;
    // Calculate and lock absolute target drop timestamp (H2)
    task.targetAt = task.targetAt ?? nextExactDropAt(task.targetHour, task.targetMinute, second, now);

    const stored = await storage.mutateTasks((tasks) => {
      const same = tasks.find(
        (x) =>
          x.status === "pending" &&
          isSamePageUrl(x.targetUrl, task.targetUrl) &&
          x.targetHour === task.targetHour &&
          x.targetMinute === task.targetMinute &&
          (x.targetSecond ?? 0) === second
      );
      if (same) {
        Object.assign(same, { ...task, id: same.id, createdAt: same.createdAt });
        return same;
      }
      tasks.push(task);
      return task;
    });
    await chrome.alarms.clear(`dh_task_${stored.id}`);
    this.createAlarm(stored, now);
    console.log(`[TaskScheduler] Task ${stored.id} scheduled for drop ${new Date(stored.targetAt!).toLocaleString()}`);
    return stored;
  }

  /** Changes a scheduled hunt (time, button / page, every day, refresh) and resets its alarm. */
  async updateTask(changes: ScheduledTask): Promise<void> {
    const now = Date.now();
    const updated = await storage.mutateTasks((tasks) => {
      const task = tasks.find((x) => x.id === changes.id);
      if (!task) return null;
      Object.assign(task, changes, {
        id: task.id,
        createdAt: task.createdAt,
        status: "pending",
        targetAt: nextExactDropAt(changes.targetHour, changes.targetMinute, changes.targetSecond ?? 0, now),
      });
      return task;
    });
    if (!updated) return;
    await chrome.alarms.clear(`dh_task_${updated.id}`);
    this.createAlarm(updated, now);
  }

  /** Opens (or focuses) the page and starts picking a button there. */
  async openAndPick(url: string): Promise<void> {
    const tabs = await chrome.tabs.query({});
    let tab = tabs.find((x) => x.url && isSamePageUrl(x.url, url));
    if (tab?.id) {
      await chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    } else {
      tab = await chrome.tabs.create({ url, active: true });
    }
    const tabId = tab.id;
    if (!tabId) return;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const current = await chrome.tabs.get(tabId).catch(() => null);
      if (!current) return;
      if (current.status === "complete") break;
      await new Promise((r) => setTimeout(r, 300));
    }
    const message = { action: MESSAGE_ACTIONS.ACTIVATE_HUD, pickTarget: true };
    try {
      await chrome.tabs.sendMessage(tabId, message);
    } catch {
      // Tab opened before the extension was installed / updated: inject the content script first
      await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] }).catch(() => {});
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }).catch(() => {});
      await chrome.tabs.sendMessage(tabId, message).catch(() => {});
    }
  }

  /**
   * Handles alarm triggers from chrome.alarms.onAlarm.
   */
  async handleAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
    if (!alarm.name.startsWith("dh_task_")) return;

    const taskId = alarm.name.replace("dh_task_", "");
    const tasks = await storage.getTasks();
    const task = tasks.find((t) => t.id === taskId);

    // Only a task still waiting for its drop is started (a stale alarm of a finished one is ignored)
    if (!task || (task.status !== "pending" && task.status !== "running")) return;

    const now = Date.now();
    const targetTimestamp = task.targetAt ?? firstDropAt(task);
    task.targetAt = targetTimestamp;

    // H2 / H3: If the alarm triggered past drop deadline grace window (15s), mark missed (a daily
    // task moves on to its next drop) and abort.
    if (now > targetTimestamp + 15_000) {
      console.warn(`[TaskScheduler] Task ${task.id} alarm fired past drop deadline.`);
      await this.handleTaskStatusUpdate(task.id, "missed", {
        result: "timeout",
        clicks: 0,
        detail: "Drop deadline expired before alarm triggered (device asleep or off)",
        finishedAt: now,
      });
      return;
    }

    // 1. The button currently remembered for the page wins over the copy stored with the task:
    // picking the button again on the page changes every hunt of that page.
    {
      try {
        const saved =
          (task.savedTargetId && (await storage.getSavedPageTargets()).find((x) => x.id === task.savedTargetId)) ||
          (await storage.getSavedTargetForUrl(task.targetUrl));
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
      // No calibration for this site: the hunt uses the last known offset (never another site's).
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
