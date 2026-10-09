import { describe, it, expect, beforeEach, vi } from "vitest";
import { HumanClicker } from "./human_clicker";

describe("HumanClicker", () => {
  let clicker: HumanClicker;

  beforeEach(() => {
    clicker = new HumanClicker();
    document.body.innerHTML = "";
  });

  it("dispatches pointer and mouse events on connected button", () => {
    const btn = document.createElement("button");
    btn.innerText = "Lưu";
    document.body.appendChild(btn);

    // Mock getBoundingClientRect
    btn.getBoundingClientRect = () => ({
      left: 100,
      top: 200,
      width: 80,
      height: 36,
      right: 180,
      bottom: 236,
      x: 100,
      y: 200,
      toJSON: () => {},
    });

    const clickSpy = vi.fn();
    btn.addEventListener("click", clickSpy);

    const success = clicker.dispatchClick(btn);
    expect(success).toBe(true);
    expect(clickSpy).toHaveBeenCalled();
    expect(clicker.getBurstCount()).toBe(1);
  });

  it("simulates approach trajectory when requested", () => {
    const btn = document.createElement("button");
    btn.innerText = "Lưu";
    document.body.appendChild(btn);

    btn.getBoundingClientRect = () => ({
      left: 150,
      top: 200,
      width: 80,
      height: 36,
      right: 230,
      bottom: 236,
      x: 150,
      y: 200,
      toJSON: () => {},
    });

    clicker.setCursorPosition({ x: 50, y: 50 });

    const moveEvents: PointerEvent[] = [];
    btn.addEventListener("pointermove", (e) => moveEvents.push(e as PointerEvent));

    const success = clicker.dispatchClick(btn, { approach: true });
    expect(success).toBe(true);
    expect(moveEvents.length).toBeGreaterThan(0);
  });

  it("dispatches asynchronous human click with dwell duration", async () => {
    const btn = document.createElement("button");
    btn.innerText = "Lưu";
    document.body.appendChild(btn);

    btn.getBoundingClientRect = () => ({
      left: 100,
      top: 100,
      width: 60,
      height: 30,
      right: 160,
      bottom: 130,
      x: 100,
      y: 100,
      toJSON: () => {},
    });

    const timeEvents: { event: string; time: number }[] = [];
    btn.addEventListener("pointerdown", () => timeEvents.push({ event: "pointerdown", time: Date.now() }));
    btn.addEventListener("pointerup", () => timeEvents.push({ event: "pointerup", time: Date.now() }));

    const success = await clicker.dispatchClickAsync(btn, { profileMode: "turbo" });
    expect(success).toBe(true);
    expect(timeEvents.length).toBe(2);
    // There must be a non-zero dwell time between pointerdown and pointerup
    expect(timeEvents[1].time - timeEvents[0].time).toBeGreaterThanOrEqual(10);
  });

  it("returns false for disconnected element", () => {
    const btn = document.createElement("button");
    const success = clicker.dispatchClick(btn);
    expect(success).toBe(false);
  });

  it("M8: returns false and does not dispatch click for elements with 0 width or height", () => {
    const btn = document.createElement("button");
    btn.innerText = "Hidden Button";
    document.body.appendChild(btn);
    btn.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    const clickSpy = vi.fn();
    btn.addEventListener("click", clickSpy);

    const success = clicker.dispatchClick(btn);
    expect(success).toBe(false);
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it("M8: returns false when target element is obscured by an overlay modal via elementFromPoint", () => {
    const btn = document.createElement("button");
    btn.innerText = "Under Modal";
    document.body.appendChild(btn);
    btn.getBoundingClientRect = () => ({
      left: 100,
      top: 100,
      width: 80,
      height: 40,
      right: 180,
      bottom: 140,
      x: 100,
      y: 100,
      toJSON: () => {},
    });

    const modalOverlay = document.createElement("div");
    modalOverlay.id = "captcha-modal-overlay";
    document.body.appendChild(modalOverlay);

    // Mock document.elementFromPoint to return modalOverlay instead of btn
    document.elementFromPoint = vi.fn().mockReturnValue(modalOverlay);

    const clickSpy = vi.fn();
    btn.addEventListener("click", clickSpy);

    const success = clicker.dispatchClick(btn);
    expect(success).toBe(false);
    expect(clickSpy).not.toHaveBeenCalled();
  });
});
