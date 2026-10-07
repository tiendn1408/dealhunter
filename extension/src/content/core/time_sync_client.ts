import { MESSAGE_ACTIONS } from "../../lib/constants";
import { ClockCalibration } from "../../lib/types";

export class TimeSyncClient {
  private offsetMs: number = 0;
  private isCalibrated: boolean = false;
  private errorMs: number = 1000;

  async init(): Promise<void> {
    try {
      const res = await chrome.runtime.sendMessage({
        action: MESSAGE_ACTIONS.GET_CALIBRATION,
      });
      const cal: ClockCalibration | null = res?.calibration ?? null;
      const stale = !cal || !cal.calibrated || Date.now() - cal.lastCalibratedAt > 10 * 60 * 1000;
      if (cal) this.applyCalibration(cal);
      if (stale) await this.calibrate();
    } catch {
      // Fallback
      this.offsetMs = 0;
    }
  }

  async calibrate(): Promise<void> {
    try {
      const res = await chrome.runtime.sendMessage({
        action: MESSAGE_ACTIONS.CALIBRATE_TIME,
        samples: 3, // second roll-overs to observe
      });
      if (res && res.calibration) {
        this.applyCalibration(res.calibration);
      }
    } catch {
      this.offsetMs = 0;
    }
  }

  applyCalibration(cal: ClockCalibration): void {
    this.offsetMs = cal.offsetMs;
    this.errorMs = cal.errorMs ?? 1000;
    this.isCalibrated = !!cal.calibrated;
  }

  getErrorMs(): number {
    return this.errorMs;
  }

  /**
   * Returns current high-precision Shopee Server Time in milliseconds.
   */
  getShopeeTime(): number {
    return Date.now() + this.offsetMs;
  }

  getOffset(): number {
    return this.offsetMs;
  }

  getIsCalibrated(): boolean {
    return this.isCalibrated;
  }
}

export const timeSyncClient = new TimeSyncClient();
