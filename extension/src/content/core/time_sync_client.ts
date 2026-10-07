import { MESSAGE_ACTIONS } from "../../lib/constants";
import { ClockCalibration } from "../../lib/types";

export class TimeSyncClient {
  private offsetMs: number = 0;
  private isCalibrated: boolean = false;

  async init(): Promise<void> {
    try {
      const res = await chrome.runtime.sendMessage({
        action: MESSAGE_ACTIONS.GET_CALIBRATION,
      });
      if (res && res.calibration) {
        this.applyCalibration(res.calibration);
      } else {
        await this.calibrate();
      }
    } catch {
      // Fallback
      this.offsetMs = 0;
    }
  }

  async calibrate(): Promise<void> {
    try {
      const res = await chrome.runtime.sendMessage({
        action: MESSAGE_ACTIONS.CALIBRATE_TIME,
        samples: 3,
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
    this.isCalibrated = true;
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
