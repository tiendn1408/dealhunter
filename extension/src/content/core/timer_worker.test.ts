import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkerTimer } from "./timer_worker";

describe("WorkerTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("falls back to window interval when Worker throws or is blocked by CSP", () => {
    const originalWorker = globalThis.Worker;
    // Simulate CSP block: new Worker throws SecurityError
    (globalThis as any).Worker = vi.fn().mockImplementation(() => {
      throw new Error("SecurityError: Failed to construct 'Worker'");
    });

    const timer = new WorkerTimer();
    const tick = vi.fn();

    timer.start(50, tick);

    expect(tick).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(tick).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    expect(tick).toHaveBeenCalledTimes(3);

    timer.stop();
    vi.advanceTimersByTime(100);
    expect(tick).toHaveBeenCalledTimes(3);

    (globalThis as any).Worker = originalWorker;
  });
});
