/**
 * HumanClicker dispatches a full sequence of synthetic pointer and mouse events
 * with random coordinate jitter to prevent triggering Shopee anti-bot / anti-fraud defenses.
 */
export class HumanClicker {
  private isBursting: boolean = false;
  private burstCount: number = 0;
  private maxBurstClicks: number = 30;

  /**
   * Dispatches realistic pointerdown -> mousedown -> pointerup -> mouseup -> click
   * with coordinates placed within the inner safe zone of the target element.
   */
  dispatchClick(element: HTMLElement): boolean {
    if (!element || !element.isConnected) return false;

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    // Random coordinates inside 30% to 70% of the button bounding box
    const clientX = rect.left + rect.width * (0.3 + Math.random() * 0.4);
    const clientY = rect.top + rect.height * (0.3 + Math.random() * 0.4);

    const eventInit: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
      screenX: clientX + window.screenX,
      screenY: clientY + window.screenY,
    };

    try {
      element.dispatchEvent(new PointerEvent("pointerover", eventInit));
      element.dispatchEvent(new PointerEvent("pointerenter", eventInit));
      element.dispatchEvent(new PointerEvent("pointerdown", eventInit));
      element.dispatchEvent(new MouseEvent("mousedown", eventInit));

      element.focus();

      element.dispatchEvent(new PointerEvent("pointerup", eventInit));
      element.dispatchEvent(new MouseEvent("mouseup", eventInit));
      element.dispatchEvent(new MouseEvent("click", eventInit));

      this.burstCount++;
      return true;
    } catch (err) {
      console.warn("[HumanClicker] Click dispatch error:", err);
      return false;
    }
  }

  startBurst(
    element: HTMLElement,
    intervalMs = 35,
    maxDurationMs = 2000,
    isStopConditionMet?: () => boolean,
    onComplete?: (success: boolean) => void
  ): void {
    if (this.isBursting) return;
    this.isBursting = true;
    this.burstCount = 0;

    const startTime = Date.now();

    const intervalId = setInterval(() => {
      const elapsed = Date.now() - startTime;

      // Check termination conditions
      if (
        elapsed >= maxDurationMs ||
        this.burstCount >= this.maxBurstClicks ||
        (isStopConditionMet && isStopConditionMet())
      ) {
        clearInterval(intervalId);
        this.isBursting = false;
        if (onComplete) {
          onComplete(isStopConditionMet ? isStopConditionMet() : true);
        }
        return;
      }

      this.dispatchClick(element);
    }, intervalMs);
  }

  stopBurst(): void {
    this.isBursting = false;
  }

  getBurstCount(): number {
    return this.burstCount;
  }
}

export const humanClicker = new HumanClicker();
