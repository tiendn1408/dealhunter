/**
 * Human Biometrics & Motor Control Simulation Engine
 *
 * Implements mathematical and physiological models to synthesize human-like
 * interactions for browser automation, eliminating bot detection signatures:
 * 1. Box-Muller Gaussian sampling for temporal jitter (no flat delta-t).
 * 2. 2D Bivariate Gaussian coordinate distribution centered on button safe-zones.
 * 3. Cubic Bezier cursor approach curves adhering to Fitts's Law.
 * 4. Neuromuscular fatigue & burst micro-pauses (biological cadency).
 * 5. W3C Pointer Events Level 3 hardware realism (pointerId, pointerType, pressure, buttons).
 */

export type ClickProfileMode = "stealth" | "pro_gamer" | "turbo";

export interface ClickProfile {
  mode: ClickProfileMode;
  name: string;
  description: string;
  meanIntervalMs: number;
  stdDevIntervalMs: number;
  minIntervalMs: number;
  maxIntervalMs: number;
  dwellMeanMs: number;
  dwellStdDevMs: number;
  microPauseAfterClicks: number;
  microPauseDurationMeanMs: number;
  microPauseDurationStdDevMs: number;
}

export const CLICK_PROFILES: Record<ClickProfileMode, ClickProfile> = {
  stealth: {
    mode: "stealth",
    name: "Stealth Human",
    description: "100% natural human motor speed (~6-8 CPS) with physiological variance for strict anti-bot systems",
    meanIntervalMs: 140,
    stdDevIntervalMs: 25,
    minIntervalMs: 100,
    maxIntervalMs: 220,
    dwellMeanMs: 55,
    dwellStdDevMs: 12,
    microPauseAfterClicks: 4,
    microPauseDurationMeanMs: 80,
    microPauseDurationStdDevMs: 20,
  },
  pro_gamer: {
    mode: "pro_gamer",
    name: "Pro Gamer Jitter",
    description: "Competitive jitter clicking (~12-15 CPS) with Gaussian jitter and muscle recovery cadency",
    meanIntervalMs: 72,
    stdDevIntervalMs: 14,
    minIntervalMs: 45,
    maxIntervalMs: 110,
    dwellMeanMs: 32,
    dwellStdDevMs: 8,
    microPauseAfterClicks: 6,
    microPauseDurationMeanMs: 50,
    microPauseDurationStdDevMs: 15,
  },
  turbo: {
    mode: "turbo",
    name: "Turbo Blitz",
    description: "High-speed burst (~20-25 CPS) with Gaussian temporal jitter and micro-pauses for intense voucher drops",
    meanIntervalMs: 40,
    stdDevIntervalMs: 8,
    minIntervalMs: 28,
    maxIntervalMs: 60,
    dwellMeanMs: 18,
    dwellStdDevMs: 5,
    microPauseAfterClicks: 8,
    microPauseDurationMeanMs: 35,
    microPauseDurationStdDevMs: 10,
  },
};

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Samples a random number from a Gaussian (normal) distribution N(mean, stdDev^2)
 * using the Box-Muller transform algorithm.
 */
export function sampleGaussian(mean: number, stdDev: number, min?: number, max?: number): number {
  let u1 = 0;
  let u2 = 0;
  // Ensure non-zero values for log
  while (u1 === 0) u1 = Math.random();
  while (u2 === 0) u2 = Math.random();

  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  let val = mean + z0 * stdDev;

  if (min !== undefined && val < min) val = min;
  if (max !== undefined && val > max) val = max;

  return val;
}

/**
 * Calculates human-like click coordinates inside an element bounding box.
 * Real humans do not uniformly scatter clicks; they cluster around the visual center
 * with a 2D Gaussian distribution bounded to a safe margin.
 */
export function calculateHumanClickCoordinates(rect: DOMRect): { clientX: number; clientY: number } {
  if (rect.width <= 0 || rect.height <= 0) {
    return {
      clientX: Math.round(rect.left),
      clientY: Math.round(rect.top),
    };
  }

  // 2D Gaussian centered at 0.5 (relative to width/height) with stdDev = 0.10, clamped to [0.25, 0.75]
  const relX = sampleGaussian(0.5, 0.1, 0.25, 0.75);
  const relY = sampleGaussian(0.5, 0.1, 0.25, 0.75);

  return {
    clientX: Math.round(rect.left + rect.width * relX),
    clientY: Math.round(rect.top + rect.height * relY),
  };
}

/**
 * Computes the time interval until the next click based on the active profile,
 * incorporating Gaussian temporal variance and biological micro-pauses.
 */
export function computeNextInterval(
  profile: ClickProfile,
  clickCount: number
): { intervalMs: number; isMicroPause: boolean } {
  let interval = sampleGaussian(
    profile.meanIntervalMs,
    profile.stdDevIntervalMs,
    profile.minIntervalMs,
    profile.maxIntervalMs
  );

  // Neuromuscular fatigue / micro-pause every N clicks
  const isMicroPause = clickCount > 0 && clickCount % profile.microPauseAfterClicks === 0;
  if (isMicroPause) {
    const pause = sampleGaussian(
      profile.microPauseDurationMeanMs,
      profile.microPauseDurationStdDevMs,
      20,
      150
    );
    interval += pause;
  }

  return {
    intervalMs: Math.round(interval),
    isMicroPause,
  };
}

/**
 * Generates an approach trajectory from a starting point to target coordinates
 * using a Cubic Bezier curve with Fitts's Law ease-out deceleration.
 */
export function generateBezierTrajectory(
  start: Point2D,
  target: Point2D,
  steps = 5
): Point2D[] {
  if (steps <= 1) return [target];

  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // If distance is very small, no path needed
  if (dist < 4) return [target];

  // Control points with perpendicular tremor / natural hand curve
  const midX = (start.x + target.x) / 2;
  const midY = (start.y + target.y) / 2;
  const perpX = -dy / dist;
  const perpY = dx / dist;

  const curvature = sampleGaussian(0, dist * 0.15, -dist * 0.3, dist * 0.3);

  const p1: Point2D = {
    x: start.x + dx * 0.25 + perpX * curvature,
    y: start.y + dy * 0.25 + perpY * curvature,
  };

  const p2: Point2D = {
    x: start.x + dx * 0.75 + perpX * (curvature * 0.5),
    y: start.y + dy * 0.75 + perpY * (curvature * 0.5),
  };

  const points: Point2D[] = [];

  for (let i = 1; i <= steps; i++) {
    // Ease-out curve parameter t: decelerates as it approaches target (Fitts's Law)
    const linearT = i / steps;
    const t = 1 - Math.pow(1 - linearT, 2);

    const omt = 1 - t;
    const omt2 = omt * omt;
    const omt3 = omt2 * omt;
    const t2 = t * t;
    const t3 = t2 * t;

    const x = omt3 * start.x + 3 * omt2 * t * p1.x + 3 * omt * t2 * p2.x + t3 * target.x;
    const y = omt3 * start.y + 3 * omt2 * t * p1.y + 3 * omt * t2 * p2.y + t3 * target.y;

    points.push({
      x: Math.round(x),
      y: Math.round(y),
    });
  }

  return points;
}

export interface RealisticDispatchOptions {
  clientX?: number;
  clientY?: number;
  pointerId?: number;
  dwellMs?: number;
}

/**
 * Dispatches realistic W3C Level 3 Pointer & Mouse events with authentic hardware properties.
 */
export function dispatchRealisticMouseEventSequence(
  element: HTMLElement,
  coords: { clientX: number; clientY: number },
  dwellMs = 0
): boolean {
  if (!element || !element.isConnected) return false;

  const { clientX, clientY } = coords;
  const screenX = typeof window !== "undefined" ? clientX + (window.screenX || 0) : clientX;
  const screenY = typeof window !== "undefined" ? clientY + (window.screenY || 0) : clientY;
  const view = typeof window !== "undefined" ? window : null;

  const baseInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view,
    clientX,
    clientY,
    screenX,
    screenY,
  };

  const pointerBaseInit = {
    ...baseInit,
    pointerId: 1,
    pointerType: "mouse" as const,
    isPrimary: true,
    width: 1,
    height: 1,
    tiltX: 0,
    tiltY: 0,
  };

  try {
    // 1. Hover entry
    element.dispatchEvent(new PointerEvent("pointerover", { ...pointerBaseInit, button: 0, buttons: 0, pressure: 0 }));
    element.dispatchEvent(new PointerEvent("pointerenter", { ...pointerBaseInit, button: 0, buttons: 0, pressure: 0 }));

    // 2. Press down
    element.dispatchEvent(
      new PointerEvent("pointerdown", {
        ...pointerBaseInit,
        button: 0,
        buttons: 1,
        pressure: 0.5,
      })
    );
    element.dispatchEvent(
      new MouseEvent("mousedown", {
        ...baseInit,
        button: 0,
        buttons: 1,
        detail: 1,
      })
    );

    // 3. Focus
    try {
      element.focus();
    } catch {
      // ignore
    }

    // 4. Release and click
    element.dispatchEvent(
      new PointerEvent("pointerup", {
        ...pointerBaseInit,
        button: 0,
        buttons: 0,
        pressure: 0,
      })
    );
    element.dispatchEvent(
      new MouseEvent("mouseup", {
        ...baseInit,
        button: 0,
        buttons: 0,
        detail: 1,
      })
    );
    element.dispatchEvent(
      new MouseEvent("click", {
        ...baseInit,
        button: 0,
        buttons: 0,
        detail: 1,
      })
    );

    return true;
  } catch (err) {
    console.warn("[HumanBiometrics] Event dispatch failed:", err);
    return false;
  }
}
