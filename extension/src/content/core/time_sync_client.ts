import { MESSAGE_ACTIONS, STORAGE_KEYS } from "../../lib/constants";
import { ClockCalibration } from "../../lib/types";

export class TimeSyncClient {
  private offsetMs: number = 0;
  private isCalibrated: boolean = false;
  private errorMs: number = 1000;
  private serverHost: string = "";
  private isCalibrating: boolean = false;
  private listeners: Set<(cal: ClockCalibration) => void> = new Set();

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("focus", () => this.checkAndRevalidate());
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          this.checkAndRevalidate();
        }
      });
    }

    if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "local" && changes[STORAGE_KEYS.DOMAIN_CALIBRATIONS]) {
          const dict = changes[STORAGE_KEYS.DOMAIN_CALIBRATIONS].newValue as Record<string, ClockCalibration> | undefined;
          const currentDomain = this.getCurrentDomain();
          if (dict && dict[currentDomain]) {
            this.applyCalibration(dict[currentDomain]);
          }
        }
      });
    }
  }

  getCurrentDomain(): string {
    return typeof window !== "undefined" && window.location.hostname
      ? window.location.hostname.replace(/^www\./, "").toLowerCase()
      : "";
  }

  async checkAndRevalidate(): Promise<void> {
    const currentDomain = this.getCurrentDomain();
    if (!currentDomain) return;

    const isMatch = this.serverHost.replace(/^www\./, "").toLowerCase() === currentDomain;
    if (!this.isCalibrated || !isMatch) {
      await this.init();
    }
  }

  async init(): Promise<void> {
    const currentDomain = this.getCurrentDomain();
    try {
      const res = await chrome.runtime.sendMessage({
        action: MESSAGE_ACTIONS.GET_CALIBRATION,
        domain: currentDomain,
      });
      const cal: ClockCalibration | null = res?.calibration ?? null;
      const isMatch = !!(cal && cal.serverHost && cal.serverHost.replace(/^www\./, "").toLowerCase() === currentDomain);
      const isFresh = !!(cal && cal.calibrated && Date.now() - cal.lastCalibratedAt < 5 * 60 * 1000);

      if (cal && isMatch && isFresh) {
        this.applyCalibration(cal);
      } else {
        // Missing, mismatched or stale: trigger calibration immediately for current domain
        await this.calibrate();
      }
    } catch {
      // Fallback
      this.offsetMs = 0;
    }
  }

  async calibrate(targetUrl?: string): Promise<ClockCalibration | null> {
    if (this.isCalibrating) return null;
    this.isCalibrating = true;
    try {
      const defaultPing =
        typeof window !== "undefined" && window.location.origin
          ? `${window.location.origin}/favicon.ico`
          : undefined;
      const res = await chrome.runtime.sendMessage({
        action: MESSAGE_ACTIONS.CALIBRATE_TIME,
        samples: 3, // second roll-overs to observe
        targetUrl: targetUrl || defaultPing,
      });
      if (res && res.calibration) {
        this.applyCalibration(res.calibration);
        return res.calibration;
      }
    } catch {
      this.offsetMs = 0;
    } finally {
      this.isCalibrating = false;
    }
    return null;
  }

  applyCalibration(cal: ClockCalibration): void {
    this.offsetMs = cal.offsetMs;
    this.errorMs = cal.errorMs ?? 1000;
    this.isCalibrated = !!cal.calibrated;
    this.serverHost = cal.serverHost || "";

    for (const listener of this.listeners) {
      try {
        listener(cal);
      } catch {
        // ignore listener errors
      }
    }
  }

  onCalibrationChange(listener: (cal: ClockCalibration) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getErrorMs(): number {
    return this.errorMs;
  }

  /**
   * Returns current high-precision server / calibrated time in milliseconds.
   */
  getServerTime(): number {
    return Date.now() + this.offsetMs;
  }

  /** Alias for backward compatibility */
  getShopeeTime(): number {
    return this.getServerTime();
  }

  getServerHost(): string {
    return this.serverHost;
  }

  getOffset(): number {
    return this.offsetMs;
  }

  getIsCalibrated(): boolean {
    return this.isCalibrated;
  }
}

export const timeSyncClient = new TimeSyncClient();
