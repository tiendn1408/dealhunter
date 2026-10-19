import { CLOCK_REFINE_ROUNDS, MESSAGE_ACTIONS, STORAGE_KEYS } from "../../lib/constants";
import { ClockCalibration, PlatformTier } from "../../lib/types";

export class TimeSyncClient {
  private offsetMs: number = 0;
  private rttMs: number = 0;
  private isCalibrated: boolean = false;
  private errorMs: number = 1000;
  private serverHost: string = "";
  private isCalibrating: boolean = false;
  private listeners: Set<(cal: ClockCalibration) => void> = new Set();
  /**
   * Set by the first init(): a hunt, a scheduled task or the open HUD needs this page's clock.
   * Until then focus / tab switches do nothing, so ordinary pages are never probed (decision 2).
   */
  private inUse = false;

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("focus", () => {
        if (this.inUse) this.checkAndRevalidate();
      });
      document.addEventListener("visibilitychange", () => {
        if (this.inUse && document.visibilityState === "visible") {
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
    this.inUse = true;
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

  /**
   * Precise calibration shortly before a drop: the usual measurement, then single probes aimed at the
   * server's next second boundaries to halve the uncertainty each second (about 10 s in all).
   */
  calibratePrecise(): Promise<ClockCalibration | null> {
    return this.calibrate(undefined, CLOCK_REFINE_ROUNDS);
  }

  async calibrate(targetUrl?: string, refine = 0): Promise<ClockCalibration | null> {
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
        refine, // probes aimed at second boundaries (precise mode)
        targetUrl: targetUrl || defaultPing,
      });
      if (res && res.calibration) {
        // A failed re-measure (offline, probe blocked) must not replace a good measurement of this site
        // with the computer's own clock: keep the last good offset, as the stored calibration does.
        if (!res.calibration.calibrated && this.isCalibrated) return null;
        this.applyCalibration(res.calibration);
        return res.calibration;
      }
    } catch {
      if (!this.isCalibrated) this.offsetMs = 0;
    } finally {
      this.isCalibrating = false;
    }
    return null;
  }

  applyCalibration(cal: ClockCalibration): void {
    this.offsetMs = cal.offsetMs;
    this.rttMs = cal.rttMs ?? 0;
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

  getRttMs(): number {
    return this.rttMs;
  }

  /**
   * Computes recommended pre-fire lead (ms) for the current target platform.
   * On major marketplaces, zero lead prevents triggering strict pre-drop bot defenses.
   * On speed-priority platforms, compensates for network latency (RTT / 2) to ensure
   * the request lands at the remote server right at 00:00:00.000.
   */
  getRecommendedPreFireLeadMs(tier?: PlatformTier): number {
    if (tier === "major_marketplace") return 0;

    const domain = this.getCurrentDomain();
    const isLocal = domain === "localhost" || domain === "127.0.0.1" || !domain;
    if (isLocal) {
      return 28; // Safe default for local simulator
    }

    if (this.rttMs > 0) {
      // Dynamic network latency compensation: one-way flight time RTT / 2 clamped between 28ms and 180ms
      return Math.min(180, Math.max(28, Math.round(this.rttMs / 2)));
    }

    return 28;
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
