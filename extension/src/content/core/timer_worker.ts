/**
 * WorkerTimer provides an un-throttled high-precision interval ticker
 * by creating an inline Web Worker from a Blob URL.
 * Web Workers are exempt from Chrome's background tab timer clamping (which caps to 1000ms).
 */
export class WorkerTimer {
  private worker: Worker | null = null;
  private onTickCallback: (() => void) | null = null;

  start(intervalMs = 30, onTick: () => void): void {
    this.stop();
    this.onTickCallback = onTick;

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
    this.worker = new Worker(url);

    this.worker.onmessage = (e) => {
      if (e.data === "tick" && this.onTickCallback) {
        this.onTickCallback();
      }
    };

    this.worker.postMessage({ action: "start", interval: intervalMs });
  }

  stop(): void {
    if (this.worker) {
      this.worker.postMessage({ action: "stop" });
      this.worker.terminate();
      this.worker = null;
    }
    this.onTickCallback = null;
  }
}

export const workerTimer = new WorkerTimer();
