import {
  calculateHumanClickCoordinates,
  computeNextInterval,
  dispatchRealisticMouseEventSequence,
  generateBezierTrajectory,
  CLICK_PROFILES,
  ClickProfileMode,
  Point2D,
} from "./human_biometrics";

export interface HumanClickOptions {
  profileMode?: ClickProfileMode;
  approach?: boolean;
}

/**
 * HumanClicker dispatches an authentic biometric sequence of synthetic pointer
 * and mouse events using Gaussian spatial clustering, Bezier trajectory approach,
 * and W3C Pointer Events Level 3 hardware attributes.
 */
export class HumanClicker {
  private isBursting: boolean = false;
  private burstCount: number = 0;
  private maxBurstClicks: number = 50;
  private lastCursorPos: Point2D = { x: 0, y: 0 };

  /**
   * Dispatches realistic pointerover -> pointerenter -> pointerdown -> mousedown -> focus -> pointerup -> mouseup -> click
   * with coordinates distributed via 2D Gaussian centering and optional Bezier approach path.
   */
  dispatchClick(element: HTMLElement, options?: HumanClickOptions): boolean {
    if (!element || !element.isConnected) return false;

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      try {
        element.click();
        this.burstCount++;
        return true;
      } catch {
        return false;
      }
    }

    const coords = calculateHumanClickCoordinates(rect);

    // If approach is requested and previous cursor is away from target, simulate trajectory
    if (options?.approach && (this.lastCursorPos.x !== 0 || this.lastCursorPos.y !== 0)) {
      this.simulateApproach(element, coords);
    }

    this.lastCursorPos = { x: coords.clientX, y: coords.clientY };

    const success = dispatchRealisticMouseEventSequence(element, coords);
    if (success) {
      this.burstCount++;
    }
    return success;
  }

  /**
   * Simulates a smooth Bezier approach from current cursor position towards the target coordinates.
   */
  simulateApproach(element: HTMLElement, targetCoords: { clientX: number; clientY: number }): void {
    if (typeof window === "undefined") return;

    const start: Point2D =
      this.lastCursorPos.x > 0 && this.lastCursorPos.y > 0
        ? this.lastCursorPos
        : {
            x: Math.max(0, targetCoords.clientX - 60),
            y: Math.max(0, targetCoords.clientY - 40),
          };

    const target: Point2D = { x: targetCoords.clientX, y: targetCoords.clientY };
    const trajectory = generateBezierTrajectory(start, target, 4);

    for (const pt of trajectory) {
      try {
        const moveInit = {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          clientX: pt.x,
          clientY: pt.y,
          screenX: pt.x + (window.screenX || 0),
          screenY: pt.y + (window.screenY || 0),
        };
        element.dispatchEvent(
          new PointerEvent("pointermove", {
            ...moveInit,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            pressure: 0,
            buttons: 0,
          })
        );
        element.dispatchEvent(new MouseEvent("mousemove", moveInit));
      } catch {
        // ignore
      }
    }
  }

  /**
   * Dispatches human click with asynchronous biological dwell duration (press-to-release hold).
   */
  async dispatchClickAsync(element: HTMLElement, options?: HumanClickOptions): Promise<boolean> {
    if (!element || !element.isConnected) return false;

    const profileMode = options?.profileMode ?? "pro_gamer";
    const profile = CLICK_PROFILES[profileMode] ?? CLICK_PROFILES.pro_gamer;

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return this.dispatchClick(element, options);
    }

    const coords = calculateHumanClickCoordinates(rect);

    if (options?.approach) {
      this.simulateApproach(element, coords);
    }

    this.lastCursorPos = { x: coords.clientX, y: coords.clientY };

    // Dwell delay in milliseconds
    const dwellMs = Math.max(15, Math.round(profile.dwellMeanMs));

    // Down phase
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
    };

    try {
      element.dispatchEvent(new PointerEvent("pointerover", { ...pointerBaseInit, buttons: 0, pressure: 0 }));
      element.dispatchEvent(new PointerEvent("pointerenter", { ...pointerBaseInit, buttons: 0, pressure: 0 }));
      element.dispatchEvent(new PointerEvent("pointerdown", { ...pointerBaseInit, button: 0, buttons: 1, pressure: 0.5 }));
      element.dispatchEvent(new MouseEvent("mousedown", { ...baseInit, button: 0, buttons: 1, detail: 1 }));

      try {
        element.focus();
      } catch {
        // ignore
      }

      await new Promise((resolve) => setTimeout(resolve, dwellMs));

      element.dispatchEvent(new PointerEvent("pointerup", { ...pointerBaseInit, button: 0, buttons: 0, pressure: 0 }));
      element.dispatchEvent(new MouseEvent("mouseup", { ...baseInit, button: 0, buttons: 0, detail: 1 }));
      element.dispatchEvent(new MouseEvent("click", { ...baseInit, button: 0, buttons: 0, detail: 1 }));

      this.burstCount++;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Starts a burst of clicks with biological pacing and micro-pauses.
   */
  startBurst(
    element: HTMLElement,
    profileMode: ClickProfileMode = "pro_gamer",
    maxDurationMs = 2500,
    isStopConditionMet?: () => boolean,
    onComplete?: (success: boolean) => void
  ): void {
    if (this.isBursting) return;
    this.isBursting = true;
    this.burstCount = 0;

    const profile = CLICK_PROFILES[profileMode] ?? CLICK_PROFILES.pro_gamer;
    const startTime = Date.now();

    const scheduleNext = () => {
      if (!this.isBursting) return;

      const elapsed = Date.now() - startTime;
      if (
        elapsed >= maxDurationMs ||
        this.burstCount >= this.maxBurstClicks ||
        (isStopConditionMet && isStopConditionMet())
      ) {
        this.isBursting = false;
        if (onComplete) {
          onComplete(isStopConditionMet ? isStopConditionMet() : true);
        }
        return;
      }

      this.dispatchClick(element, { profileMode, approach: this.burstCount === 0 });

      const next = computeNextInterval(profile, this.burstCount);
      setTimeout(scheduleNext, next.intervalMs);
    };

    scheduleNext();
  }

  stopBurst(): void {
    this.isBursting = false;
  }

  getBurstCount(): number {
    return this.burstCount;
  }

  setCursorPosition(pos: Point2D): void {
    this.lastCursorPos = pos;
  }
}

export const humanClicker = new HumanClicker();
