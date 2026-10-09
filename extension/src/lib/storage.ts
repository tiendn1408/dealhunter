import { STORAGE_KEYS, DEFAULT_SETTINGS } from "./constants";
import { ScheduledTask, ClockCalibration, ExtensionSettings, SavedPageTarget } from "./types";
import { DealHunterEndpoints, resolveEndpoints } from "./endpoints";

export const storage = {
  async getTasks(): Promise<ScheduledTask[]> {
    const data = await chrome.storage.local.get(STORAGE_KEYS.SCHEDULED_TASKS);
    return data[STORAGE_KEYS.SCHEDULED_TASKS] || [];
  },

  async saveTasks(tasks: ScheduledTask[]): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEYS.SCHEDULED_TASKS]: tasks });
  },

  async addTask(task: ScheduledTask): Promise<void> {
    const tasks = await this.getTasks();
    tasks.push(task);
    await this.saveTasks(tasks);
  },

  async removeTask(id: string): Promise<void> {
    const tasks = await this.getTasks();
    const filtered = tasks.filter((t) => t.id !== id);
    await this.saveTasks(filtered);
  },

  async updateTaskStatus(
    id: string,
    status: ScheduledTask["status"],
    lastResult?: ScheduledTask["lastResult"]
  ): Promise<void> {
    const tasks = await this.getTasks();
    const task = tasks.find((t) => t.id === id);
    if (task) {
      task.status = status;
      if (lastResult) task.lastResult = lastResult;
      await this.saveTasks(tasks);
    }
  },

  async getCalibration(domain?: string): Promise<ClockCalibration | null> {
    if (domain) {
      const clean = domain.replace(/^www\./, "").toLowerCase();
      const domainData = await chrome.storage.local.get(STORAGE_KEYS.DOMAIN_CALIBRATIONS);
      const dict = (domainData[STORAGE_KEYS.DOMAIN_CALIBRATIONS] || {}) as Record<string, ClockCalibration>;
      if (dict[clean]) {
        return dict[clean];
      }
      return null;
    }
    const data = await chrome.storage.local.get(STORAGE_KEYS.CLOCK_CALIBRATION);
    return data[STORAGE_KEYS.CLOCK_CALIBRATION] || null;
  },

  async saveCalibration(calibration: ClockCalibration): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEYS.CLOCK_CALIBRATION]: calibration });
    if (calibration.serverHost) {
      const clean = calibration.serverHost.replace(/^www\./, "").toLowerCase();
      const domainData = await chrome.storage.local.get(STORAGE_KEYS.DOMAIN_CALIBRATIONS);
      const dict = (domainData[STORAGE_KEYS.DOMAIN_CALIBRATIONS] || {}) as Record<string, ClockCalibration>;
      dict[clean] = calibration;
      await chrome.storage.local.set({ [STORAGE_KEYS.DOMAIN_CALIBRATIONS]: dict });
    }
  },

  async getSettings(): Promise<ExtensionSettings> {
    const data = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    return { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.SETTINGS] || {}) };
  },

  async saveSettings(settings: Partial<ExtensionSettings>): Promise<void> {
    const current = await this.getSettings();
    await chrome.storage.local.set({
      [STORAGE_KEYS.SETTINGS]: { ...current, ...settings },
    });
  },

  /** Validated DealHunter API/web URLs (pushed by the web app; dev defaults otherwise). */
  async getEndpoints(): Promise<DealHunterEndpoints> {
    return resolveEndpoints(await this.getSettings());
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
    try {
      const current = new URL(url);
      return (
        targets.find((t) => {
          try {
            const u = new URL(t.url);
            return u.origin === current.origin && u.pathname === current.pathname;
          } catch {
            return t.url === url;
          }
        }) || null
      );
    } catch {
      return targets.find((t) => t.url === url) || null;
    }
  },

  async savePageTarget(target: SavedPageTarget): Promise<void> {
    const targets = await this.getSavedPageTargets();
    const index = targets.findIndex(
      (t) => t.id === target.id || (t.origin === target.origin && t.url === target.url)
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

