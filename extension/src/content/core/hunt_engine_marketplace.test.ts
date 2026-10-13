import { describe, it, expect, vi } from "vitest";
import { shopeeAdapter } from "../adapters/shopee_adapter";

// On a marketplace page the engine has an adapter; a voucher that runs out after the click must be
// reported as exhausted, not as saved (the adapter's "finished" also covers sold out).
vi.mock("../adapters", () => ({ getAdapterForUrl: () => shopeeAdapter }));
const { startHunt } = await import("./hunt_engine");

const DROP = 1_800_000_000_000;

describe("startHunt on a marketplace adapter", () => {
  it("reports exhausted when the voucher runs out after the click", () => {
    HTMLElement.prototype.getBoundingClientRect = () =>
      ({ left: 10, top: 10, width: 80, height: 30, right: 90, bottom: 40, x: 10, y: 10, toJSON() {} }) as DOMRect;
    HTMLElement.prototype.scrollIntoView = () => {};
    document.body.innerHTML = `<div class="voucher-card"><span>Giảm 15%</span><button id="b">Lưu</button></div>`;
    const btn = document.getElementById("b")!;
    btn.addEventListener("click", () => {
      btn.textContent = "Hết lượt";
      btn.classList.add("exhausted");
    });

    let now = DROP - 1000;
    let cb: (() => void) | null = null;
    let result = "";
    startHunt({
      targetTimestamp: DROP,
      now: () => now,
      locked: btn,
      platformTier: "major_marketplace",
      ticker: { start: (_: number, f: () => void) => (cb = f), stop: () => (cb = null) },
      onDone: (o) => (result = o.result),
    });
    while (now < DROP + 1500 && cb) {
      now += 10;
      (cb as () => void)();
    }
    expect(result).toBe("exhausted");
  });
});
