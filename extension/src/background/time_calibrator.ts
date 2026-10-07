import { SHOPEE_URLS } from "../lib/constants";
import { ClockCalibration } from "../lib/types";
import { storage } from "../lib/storage";

export class TimeCalibrator {
  private targetUrl: string = SHOPEE_URLS.PING_TARGET;

  /**
   * Pings Shopee endpoint via HEAD request to extract Date header and measure RTT.
   * Runs multiple samples, discards outliers, and computes median offset.
   */
  async calibrate(samples = 5): Promise<ClockCalibration> {
    const offsets: number[] = [];
    const rtts: number[] = [];

    for (let i = 0; i < samples; i++) {
      try {
        const tStart = Date.now();
        const res = await fetch(this.targetUrl, {
          method: "HEAD",
          cache: "no-store",
        });
        const tEnd = Date.now();
        const rtt = tEnd - tStart;

        const serverDateHeader = res.headers.get("Date");
        if (serverDateHeader) {
          const serverTimestamp = new Date(serverDateHeader).getTime();
          // Adjust server timestamp with half-RTT latency estimate
          const adjustedServerTime = serverTimestamp + rtt / 2;
          const offset = adjustedServerTime - tEnd;

          offsets.push(offset);
          rtts.push(rtt);
        }
      } catch (err) {
        console.warn("[TimeCalibrator] Sample ping failed:", err);
      }

      // Small pause between samples
      if (i < samples - 1) {
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    if (offsets.length === 0) {
      // Fallback: 0 offset if network is offline
      const fallback: ClockCalibration = {
        offsetMs: 0,
        rttMs: 0,
        lastCalibratedAt: Date.now(),
      };
      await storage.saveCalibration(fallback);
      return fallback;
    }

    // Sort to compute median
    offsets.sort((a, b) => a - b);
    rtts.sort((a, b) => a - b);

    const medianOffset = offsets[Math.floor(offsets.length / 2)];
    const medianRtt = rtts[Math.floor(rtts.length / 2)];

    const calibration: ClockCalibration = {
      offsetMs: medianOffset,
      rttMs: medianRtt,
      lastCalibratedAt: Date.now(),
    };

    await storage.saveCalibration(calibration);
    return calibration;
  }
}

export const timeCalibrator = new TimeCalibrator();
