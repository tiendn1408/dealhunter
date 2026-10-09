/**
 * WorkerTimer provides an un-throttled high-precision interval ticker
 * by creating an inline Web Worker from a Blob URL.
 * Web Workers are exempt from Chrome's background tab timer clamping (which caps to 1000ms).
 */
export class WorkerTimer {
  private worker: Worker | null = null;
  private fallbackTimerId: ReturnType<typeof setInterval> | null = null;
  private onTickCallback: (() => void) | null = null;

  start(intervalMs = 30, onTick: () => void): void {
    this.stop();
    this.onTickCallback = onTick;

    let workerStarted = false;
    if (typeof Worker !== "undefined" && typeof Blob !== "undefined" && typeof URL !== "undefined") {
      try {
        const workerCode = `
          let timerId = null;
          self.onmessage = function(e) {
            if (e.data.action === 'start') {
              if (timerId) clearInterval(timerId);
              timerId = setInterval(() => {
                self.postMessage('tick');
              }, e.data.interval);
            } else if (e.data.action === 'stop') {
              if (timerId) clearInterval(timerId);
              timerId = null;
            }
          };
        `;

        const blob = new Blob([workerCode], { type: "application/javascript" });
        const url = URL.createObjectURL(blob);
        const w = new Worker(url);
        URL.revokeObjectURL(url);

        w.onmessage = (e) => {
          if (e.data === "tick" && this.onTickCallback) {
            this.onTickCallback();
          }
        };

        w.postMessage({ action: "start", interval: intervalMs });
        this.worker = w;
        workerStarted = true;
      } catch (err) {
        console.warn("[DealHunter] Web Worker initialization blocked (CSP) or unsupported, falling back to window timer:", err);
      }
    }

    if (!workerStarted) {
      this.fallbackTimerId = setInterval(() => {
        if (this.onTickCallback) {
          this.onTickCallback();
        }
      }, intervalMs);
    }
  }

  stop(): void {
    if (this.worker) {
      try {
        this.worker.postMessage({ action: "stop" });
        this.worker.terminate();
      } catch {
        // Ignore termination errors
      }
      this.worker = null;
    }
    if (this.fallbackTimerId !== null) {
      clearInterval(this.fallbackTimerId);
      this.fallbackTimerId = null;
    }
    this.onTickCallback = null;
  }
}

export const workerTimer = new WorkerTimer();
