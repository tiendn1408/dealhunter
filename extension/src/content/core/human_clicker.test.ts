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
  });

  it("returns false for disconnected element", () => {
    const btn = document.createElement("button");
    const success = clicker.dispatchClick(btn);
    expect(success).toBe(false);
  });
});
