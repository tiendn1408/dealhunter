import { STORAGE_KEYS, DEFAULT_SETTINGS } from "./constants";
import { ScheduledTask, ClockCalibration, ExtensionSettings, SavedPageTarget } from "./types";
import { DealHunterEndpoints, resolveEndpoints } from "./endpoints";
import { isSamePageUrl } from "./url";

// Settings are read-modify-written: queue the writes of this context so concurrent ones never drop each
// other's keys. (Other contexts write only the keys they own; the web URL has its own storage key.)
let settingsWrites: Promise<unknown> = Promise.resolve();
let taskWrites: Promise<unknown> = Promise.resolve();
let calibrationWrites: Promise<unknown> = Promise.resolve();

function enqueueTaskMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const next = taskWrites.then(mutation, mutation);
  taskWrites = next.catch(() => {});
  return next;
}

export const storage = {
  async getTasks(): Promise<ScheduledTask[]> {
    const data = await chrome.storage.local.get(STORAGE_KEYS.SCHEDULED_TASKS);
    return data[STORAGE_KEYS.SCHEDULED_TASKS] || [];
  },

  async saveTasks(tasks: ScheduledTask[]): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEYS.SCHEDULED_TASKS]: tasks });
  },

  async addTask(task: ScheduledTask): Promise<void> {
    return enqueueTaskMutation(async () => {
      const tasks = await this.getTasks();
      tasks.push(task);
      await this.saveTasks(tasks);
    });
  },

  async removeTask(id: string): Promise<void> {
    return enqueueTaskMutation(async () => {
      const tasks = await this.getTasks();
      const filtered = tasks.filter((t) => t.id !== id);
      await this.saveTasks(filtered);
    });
  },

  async updateTaskStatus(
    id: string,
    status: ScheduledTask["status"],
    lastResult?: ScheduledTask["lastResult"]
  ): Promise<void> {
    return enqueueTaskMutation(async () => {
      const tasks = await this.getTasks();
      const task = tasks.find((t) => t.id === id);
      if (task) {
        task.status = status;
        if (lastResult) task.lastResult = lastResult;
        await this.saveTasks(tasks);
      }
    });
  },

  async getCalibration(domain?: string): Promise<ClockCalibration | null> {
    const TTL_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    if (domain) {
      const clean = domain.replace(/^www\./, "").toLowerCase();
      const domainData = await chrome.storage.local.get(STORAGE_KEYS.DOMAIN_CALIBRATIONS);
      const dict = (domainData[STORAGE_KEYS.DOMAIN_CALIBRATIONS] || {}) as Record<string, ClockCalibration>;
      const cal = dict[clean];
      if (cal && now - cal.lastCalibratedAt < TTL_MS) {
        return cal;
      }
      return null;
    }
    const data = await chrome.storage.local.get(STORAGE_KEYS.CLOCK_CALIBRATION);
    const cal = (data[STORAGE_KEYS.CLOCK_CALIBRATION] || null) as ClockCalibration | null;
    if (cal && now - cal.lastCalibratedAt < TTL_MS) {
      return cal;
    }
    return null;
  },

  async saveCalibration(calibration: ClockCalibration): Promise<void> {
    const TTL_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const write = calibrationWrites.then(async () => {
      await chrome.storage.local.set({ [STORAGE_KEYS.CLOCK_CALIBRATION]: calibration });
      if (calibration.serverHost) {
        const clean = calibration.serverHost.replace(/^www\./, "").toLowerCase();
        const domainData = await chrome.storage.local.get(STORAGE_KEYS.DOMAIN_CALIBRATIONS);
        const dict = (domainData[STORAGE_KEYS.DOMAIN_CALIBRATIONS] || {}) as Record<string, ClockCalibration>;
        for (const host of Object.keys(dict)) {
          if (!dict[host] || now - dict[host].lastCalibratedAt >= TTL_MS) {
            delete dict[host];
          }
        }
        dict[clean] = calibration;
        await chrome.storage.local.set({ [STORAGE_KEYS.DOMAIN_CALIBRATIONS]: dict });
      }
    });
    calibrationWrites = write.catch(() => {});
    return write;
  },

  async getSettings(): Promise<ExtensionSettings> {
    const data = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    return { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.SETTINGS] || {}) };
  },

  async saveSettings(settings: Partial<ExtensionSettings>): Promise<void> {
    const write = settingsWrites.then(async () => {
      const data = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
      // Merge into what is stored now (not into defaults), changing only the given keys
      await chrome.storage.local.set({
        [STORAGE_KEYS.SETTINGS]: { ...(data[STORAGE_KEYS.SETTINGS] || {}), ...settings },
      });
    });
    settingsWrites = write.catch(() => {});
    return write;
  },

  /**
   * Validated DealHunter URLs for links: the last web URL a DealHunter page sent (kept after sign-out),
   * else the dev defaults. The API URL used for requests is the one stored with the session token
   * (web_session.ts), never this one.
   */
  async getEndpoints(): Promise<DealHunterEndpoints> {
    const data = await chrome.storage.local.get(STORAGE_KEYS.LAST_WEB_URL);
    const settings = await this.getSettings();
    return resolveEndpoints({
      dealHunterApiUrl: settings.dealHunterApiUrl,
      dealHunterWebUrl: data[STORAGE_KEYS.LAST_WEB_URL] ?? settings.dealHunterWebUrl,
    });
  },

  /** Remembers the web URL for links. Its own key: a single write that cannot clobber other settings. */
  async saveLastWebUrl(webUrl: string): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEYS.LAST_WEB_URL]: webUrl });
  },

  async getLanguage(): Promise<"en" | "vi"> {
    const settings = await this.getSettings();
    return settings.language || "en";
  },

  async setLanguage(language: "en" | "vi"): Promise<void> {
    await this.saveSettings({ language });
  },

  async getSavedPageTargets(): Promise<SavedPageTarget[]> {
    const data = await chrome.storage.local.get(STORAGE_KEYS.SAVED_PAGE_TARGETS);
    return data[STORAGE_KEYS.SAVED_PAGE_TARGETS] || [];
  },

  async getSavedTargetForUrl(url: string): Promise<SavedPageTarget | null> {
    const targets = await this.getSavedPageTargets();
    return targets.find((t) => isSamePageUrl(t.url, url)) || null;
  },

  async savePageTarget(target: SavedPageTarget): Promise<void> {
    const targets = await this.getSavedPageTargets();
    const index = targets.findIndex(
      (t) => t.id === target.id || isSamePageUrl(t.url, target.url)
    );
    if (index >= 0) {
      targets[index] = target;
    } else {
      targets.push(target);
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.SAVED_PAGE_TARGETS]: targets });
  },

  async removePageTarget(id: string): Promise<void> {
    const targets = await this.getSavedPageTargets();
    const filtered = targets.filter((t) => t.id !== id);
    await chrome.storage.local.set({ [STORAGE_KEYS.SAVED_PAGE_TARGETS]: filtered });
  },
};

