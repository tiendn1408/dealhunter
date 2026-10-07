import { STORAGE_KEYS, DEFAULT_SETTINGS } from "./constants";
import { ScheduledTask, ClockCalibration, ExtensionSettings } from "./types";

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

  async getCalibration(): Promise<ClockCalibration | null> {
    const data = await chrome.storage.local.get(STORAGE_KEYS.CLOCK_CALIBRATION);
    return data[STORAGE_KEYS.CLOCK_CALIBRATION] || null;
  },

  async saveCalibration(calibration: ClockCalibration): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEYS.CLOCK_CALIBRATION]: calibration });
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
};
