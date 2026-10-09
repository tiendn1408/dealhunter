import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  sampleGaussian,
  calculateHumanClickCoordinates,
  computeNextInterval,
  generateBezierTrajectory,
  dispatchRealisticMouseEventSequence,
  CLICK_PROFILES,
} from "./human_biometrics";

describe("human_biometrics", () => {
  describe("sampleGaussian", () => {
    it("generates values distributed around mean with non-zero variance", () => {
      const mean = 100;
      const stdDev = 15;
      const samples: number[] = [];
      for (let i = 0; i < 500; i++) {
        samples.push(sampleGaussian(mean, stdDev));
      }

      const sampleMean = samples.reduce((a, b) => a + b, 0) / samples.length;
      expect(sampleMean).toBeGreaterThan(90);
      expect(sampleMean).toBeLessThan(110);

      // Verify variance is not zero
      const variance = samples.reduce((a, b) => a + Math.pow(b - sampleMean, 2), 0) / samples.length;
      expect(variance).toBeGreaterThan(50);
    });

    it("respects min and max bounds", () => {
      for (let i = 0; i < 200; i++) {
        const val = sampleGaussian(100, 50, 80, 120);
        expect(val).toBeGreaterThanOrEqual(80);
        expect(val).toBeLessThanOrEqual(120);
      }
    });
  });

  describe("calculateHumanClickCoordinates", () => {
    it("returns coordinates inside safe central region of element bounding box", () => {
      const rect = {
        left: 200,
        top: 150,
        width: 120,
        height: 40,
        right: 320,
        bottom: 190,
      } as DOMRect;

      for (let i = 0; i < 100; i++) {
        const coords = calculateHumanClickCoordinates(rect);
        expect(coords.clientX).toBeGreaterThanOrEqual(200 + 120 * 0.25);
        expect(coords.clientX).toBeLessThanOrEqual(200 + 120 * 0.75);
        expect(coords.clientY).toBeGreaterThanOrEqual(150 + 40 * 0.25);
        expect(coords.clientY).toBeLessThanOrEqual(150 + 40 * 0.75);
      }
    });

    it("handles zero dimension rect gracefully", () => {
      const rect = { left: 50, top: 80, width: 0, height: 0 } as DOMRect;
      const coords = calculateHumanClickCoordinates(rect);
      expect(coords.clientX).toBe(50);
      expect(coords.clientY).toBe(80);
    });
  });

  describe("computeNextInterval", () => {
    it("generates dynamic intervals with non-zero standard deviation", () => {
      const profile = CLICK_PROFILES.pro_gamer;
      const intervals = new Set<number>();

      for (let i = 1; i <= 20; i++) {
        const res = computeNextInterval(profile, i);
        intervals.add(res.intervalMs);
        expect(res.intervalMs).toBeGreaterThanOrEqual(profile.minIntervalMs);
      }

      // Interval must vary (temporal jitter), not be flat
      expect(intervals.size).toBeGreaterThan(5);
    });

    it("triggers biological micro-pause after specified burst count", () => {
      const profile = CLICK_PROFILES.pro_gamer;
      const pauseCount = profile.microPauseAfterClicks;

      const regular = computeNextInterval(profile, 1);
      expect(regular.isMicroPause).toBe(false);

      const microPaused = computeNextInterval(profile, pauseCount);
      expect(microPaused.isMicroPause).toBe(true);
      // Micro-pause duration increases the interval noticeably
      expect(microPaused.intervalMs).toBeGreaterThan(profile.meanIntervalMs);
    });
  });

  describe("generateBezierTrajectory", () => {
    it("generates ease-out trajectory points towards the target", () => {
      const start = { x: 100, y: 100 };
      const target = { x: 300, y: 250 };
      const points = generateBezierTrajectory(start, target, 5);

      expect(points.length).toBe(5);
      // Last point should match the target
      expect(points[points.length - 1].x).toBe(300);
      expect(points[points.length - 1].y).toBe(250);
    });

    it("handles close points without unnecessary paths", () => {
      const start = { x: 100, y: 100 };
      const target = { x: 101, y: 101 };
      const points = generateBezierTrajectory(start, target, 5);
      expect(points.length).toBe(1);
      expect(points[0]).toEqual(target);
    });
  });

  describe("dispatchRealisticMouseEventSequence", () => {
    beforeEach(() => {
      document.body.innerHTML = "";
    });

    it("dispatches full sequence with W3C Pointer Events Level 3 attributes", () => {
      const btn = document.createElement("button");
      btn.innerText = "Click Me";
      document.body.appendChild(btn);

      const events: string[] = [];
      const pointerDownDetails: { pointerType?: string; pressure?: number; buttons?: number } = {};

      btn.addEventListener("pointerover", () => events.push("pointerover"));
      btn.addEventListener("pointerenter", () => events.push("pointerenter"));
      btn.addEventListener("pointerdown", (e) => {
        events.push("pointerdown");
        const pe = e as PointerEvent;
        pointerDownDetails.pointerType = pe.pointerType;
        pointerDownDetails.pressure = pe.pressure;
        pointerDownDetails.buttons = pe.buttons;
      });
      btn.addEventListener("mousedown", () => events.push("mousedown"));
      btn.addEventListener("pointerup", () => events.push("pointerup"));
      btn.addEventListener("mouseup", () => events.push("mouseup"));
      btn.addEventListener("click", () => events.push("click"));

      const success = dispatchRealisticMouseEventSequence(btn, { clientX: 120, clientY: 85 });
      expect(success).toBe(true);
      expect(events).toEqual([
        "pointerover",
        "pointerenter",
        "pointerdown",
        "mousedown",
        "pointerup",
        "mouseup",
        "click",
      ]);

      expect(pointerDownDetails.pointerType).toBe("mouse");
      expect(pointerDownDetails.pressure).toBe(0.5);
      expect(pointerDownDetails.buttons).toBe(1);
    });

    it("returns false if element is disconnected", () => {
      const disconnected = document.createElement("button");
      const success = dispatchRealisticMouseEventSequence(disconnected, { clientX: 10, clientY: 10 });
      expect(success).toBe(false);
    });
  });
});
