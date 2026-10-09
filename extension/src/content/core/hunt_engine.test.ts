import { describe, it, expect, beforeEach, vi } from "vitest";
import { startHunt, HuntOutcome, Ticker } from "./hunt_engine";

/** Ticker driven by the test: each step() advances the fake Shopee clock and fires one tick. */
class ManualTicker implements Ticker {
  private cb: (() => void) | null = null;
  start(_ms: number, onTick: () => void) {
    this.cb = onTick;
  }
  stop() {
    this.cb = null;
  }
  get running() {
    return this.cb !== null;
  }
  tick() {
    this.cb?.();
  }
}

const DROP = 1_800_000_000_000;

function voucherCard(id: string, title: string, label = "Lưu"): string {
  return `<div class="voucher-card" id="card-${id}"><span>${title}</span><span>HSD: 10.10</span><button id="${id}">${label}</button></div>`;
}

/** happy-dom has no layout; give every element a clickable box. */
function giveLayout() {
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ left: 10, top: 10, width: 80, height: 30, right: 90, bottom: 40, x: 10, y: 10, toJSON() {} }) as DOMRect;
  HTMLElement.prototype.scrollIntoView = () => {};
}

function setup(keyword?: string, locked?: HTMLElement | null) {
  let now = DROP - 5000;
  const ticker = new ManualTicker();
  let outcome: HuntOutcome | null = null;
  startHunt({ targetTimestamp: DROP, now: () => now, keyword, locked, ticker, onDone: (o) => (outcome = o) });
  return {
    ticker,
    advanceTo(t: number) {
      while (now < t && ticker.running) {
        now += 10;
        ticker.tick();
      }
    },
    get outcome() {
      return outcome as HuntOutcome | null;
    },
  };
}

describe("startHunt", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    giveLayout();
  });

  it("does not click before the drop window", () => {
    document.body.innerHTML = voucherCard("v1", "Giảm 50k đơn 500k");
    const clicks = vi.fn();
    document.getElementById("v1")!.addEventListener("click", clicks);
    const h = setup();
    h.advanceTo(DROP - 200);
    expect(clicks).not.toHaveBeenCalled();
    expect(h.outcome).toBeNull();
  });

  it("reports saved only when the page shows the saved state", () => {
    document.body.innerHTML = voucherCard("v1", "Giảm 50k đơn 500k");
    const btn = document.getElementById("v1")!;
    let n = 0;
    btn.addEventListener("click", () => {
      if (++n === 3) btn.textContent = "Đã lưu";
    });
    const h = setup(undefined, btn);
    h.advanceTo(DROP + 1000);
    expect(h.outcome?.result).toBe("saved");
    expect(h.outcome?.clicks).toBe(3);
  });

  it("follows the voucher when React replaces the button node at the drop", () => {
    document.body.innerHTML = voucherCard("v1", "Giảm 50k đơn 500k", "Lưu");
    const locked = document.getElementById("v1")!;
    const h = setup(undefined, locked);
    h.advanceTo(DROP - 100);

    // Countdown ends: the whole card is re-rendered with a new button node
    document.body.innerHTML = voucherCard("v1-new", "Giảm 50k đơn 500k", "Lưu");
    const fresh = document.getElementById("v1-new")!;
    const freshClicks = vi.fn(() => (fresh.textContent = "Dùng ngay"));
    fresh.addEventListener("click", freshClicks);
    h.advanceTo(DROP + 500);

    expect(h.outcome?.result).toBe("saved");
    expect(freshClicks).toHaveBeenCalledTimes(1);
  });

  it("reports exhausted, not success, when the voucher runs out", () => {
    document.body.innerHTML = voucherCard("v1", "Giảm 15% tối đa 100k");
    const btn = document.getElementById("v1")!;
    btn.addEventListener("click", () => {
      btn.textContent = "Hết lượt";
      btn.classList.add("exhausted");
    });
    const h = setup(undefined, btn);
    h.advanceTo(DROP + 1000);
    expect(h.outcome?.result).toBe("exhausted");
  });

  it("reports not_found when no voucher button exists", () => {
    document.body.innerHTML = `<div>Không có voucher</div>`;
    const h = setup();
    h.advanceTo(DROP + 4000);
    expect(h.outcome?.result).toBe("not_found");
    expect(h.outcome?.clicks).toBe(0);
  });

  it("reports timeout (not success) when clicks never get confirmed", () => {
    document.body.innerHTML = voucherCard("v1", "Giảm 50k đơn 500k");
    const h = setup(undefined, document.getElementById("v1"));
    h.advanceTo(DROP + 4000);
    expect(h.outcome?.result).toBe("timeout");
    expect(h.outcome!.clicks).toBeGreaterThan(0);
    expect(h.outcome!.clicks).toBeLessThanOrEqual(80);
  });

  it("only clicks the voucher matching the keyword", () => {
    document.body.innerHTML =
      voucherCard("small", "Giảm 10k đơn 99k") + voucherCard("big", "Giảm 500k đơn 2tr");
    const small = vi.fn();
    document.getElementById("small")!.addEventListener("click", small);
    const big = document.getElementById("big")!;
    big.addEventListener("click", () => (big.textContent = "Đã lưu"));
    const h = setup("500k");
    h.advanceTo(DROP + 1000);
    expect(h.outcome?.result).toBe("saved");
    expect(small).not.toHaveBeenCalled();
  });

  it("starts clicking a voucher that only appears after the drop", () => {
    const h = setup();
    h.advanceTo(DROP + 300);
    document.body.innerHTML = voucherCard("late", "Giảm 50k đơn 500k");
    const late = document.getElementById("late")!;
    late.addEventListener("click", () => (late.textContent = "Đã lưu"));
    h.advanceTo(DROP + 1500);
    expect(h.outcome?.result).toBe("saved");
  });

  // Regression (found in real Chrome): the countdown text changes when React re-renders the card;
  // the locked voucher must still be found and the other voucher must never be clicked.
  it("re-finds the locked voucher after a re-render that changes its countdown text", () => {
    document.body.innerHTML =
      voucherCard("decoy", "Giảm 10k đơn 99k") +
      `<div class="voucher-card"><span>Giảm 50k đơn 500k</span><span>Bắt đầu sau 00:00:31</span><button id="t" disabled>Lưu</button></div>`;
    const decoy = vi.fn();
    document.getElementById("decoy")!.addEventListener("click", decoy);
    const h = setup(undefined, document.getElementById("t"));
    h.advanceTo(DROP - 100);

    document.body.innerHTML =
      voucherCard("decoy2", "Giảm 10k đơn 99k") +
      `<div class="voucher-card"><span>Giảm 50k đơn 500k</span><span>Đang diễn ra</span><button id="t2">Lưu</button></div>`;
    document.getElementById("decoy2")!.addEventListener("click", decoy);
    const t2 = document.getElementById("t2")!;
    t2.addEventListener("click", () => (t2.textContent = "Đã lưu"));
    h.advanceTo(DROP + 1000);

    expect(h.outcome?.result).toBe("saved");
    expect(decoy).not.toHaveBeenCalled();
  });

  it("never clicks a different voucher when the locked one disappears", () => {
    document.body.innerHTML = voucherCard("t", "Giảm 50k đơn 500k") + voucherCard("decoy", "Giảm 10k đơn 99k");
    const decoy = vi.fn();
    document.getElementById("decoy")!.addEventListener("click", decoy);
    const h = setup(undefined, document.getElementById("t"));
    h.advanceTo(DROP - 500);
    document.getElementById("t")!.closest(".voucher-card")!.remove();
    h.advanceTo(DROP + 4000);
    expect(decoy).not.toHaveBeenCalled();
    expect(h.outcome?.result).toBe("not_found");
  });

  it("without a lock or keyword ignores vouchers that were already open before the drop", () => {
    document.body.innerHTML =
      voucherCard("open", "Giảm 10k đơn 99k") +
      `<div class="voucher-card"><span>Giảm 50k đơn 500k</span><button id="drop" disabled>Lưu</button></div>`;
    const open = vi.fn();
    document.getElementById("open")!.addEventListener("click", open);
    const h = setup();
    h.advanceTo(DROP - 50);
    const drop = document.getElementById("drop")!;
    drop.removeAttribute("disabled");
    drop.addEventListener("click", () => (drop.textContent = "Đã lưu"));
    h.advanceTo(DROP + 1000);
    expect(h.outcome?.result).toBe("saved");
    expect(open).not.toHaveBeenCalled();
  });

  it("clicks a user-locked custom button on any website when enabled at drop", () => {
    document.body.innerHTML = `<div class="event-page"><button id="book-btn" disabled>Mua vé 00:00</button></div>`;
    const btn = document.getElementById("book-btn") as HTMLButtonElement;
    const clicks = vi.fn();
    btn.addEventListener("click", clicks);
    const h = setup(undefined, btn);
    h.advanceTo(DROP - 50);
    expect(clicks).not.toHaveBeenCalled();

    // Event begins at midnight drop: button becomes enabled
    btn.removeAttribute("disabled");
    h.advanceTo(DROP + 500);
    expect(clicks).toHaveBeenCalled();
  });

  it("relocates and clicks an arbitrary website button when React replaces the node at drop", () => {
    document.body.innerHTML = `
      <div id="checkin-container">
        <button id="daily-btn" data-testid="daily-checkin" disabled>Điểm danh</button>
      </div>
    `;
    const lockedBtn = document.getElementById("daily-btn")!;
    const h = setup(undefined, lockedBtn);
    h.advanceTo(DROP - 100);

    // React replaces the node with a fresh enabled button at drop moment
    document.body.innerHTML = `
      <div id="checkin-container">
        <button id="daily-btn-fresh" data-testid="daily-checkin">Điểm danh</button>
      </div>
    `;
    const freshBtn = document.getElementById("daily-btn-fresh")!;
    const freshClicks = vi.fn(() => {
      freshBtn.setAttribute("disabled", "true");
    });
    freshBtn.addEventListener("click", freshClicks);

    h.advanceTo(DROP + 500);
    expect(freshClicks).toHaveBeenCalled();
    expect(h.outcome?.result).toBe("saved");
  });

  it("completes immediately when a custom button text changes to completed after click", () => {
    document.body.innerHTML = `<div class="event"><button id="claim-btn">Check In</button></div>`;
    const btn = document.getElementById("claim-btn")!;
    btn.addEventListener("click", () => {
      btn.textContent = "Checked in";
    });
    const h = setup(undefined, btn);
    h.advanceTo(DROP + 200);

    expect(h.outcome?.result).toBe("saved");
    expect(h.outcome?.clicks).toBe(1);
  });

  it("triggers emergency reload handler if locked button remains disabled after drop window with dualDefenseReload", () => {
    document.body.innerHTML = `<div><button id="static-btn" disabled>Sắp mở</button></div>`;
    const btn = document.getElementById("static-btn") as HTMLButtonElement;
    let now = DROP - 1000;
    const ticker = new ManualTicker();
    const onEmergencyReload = vi.fn();
    startHunt({
      targetTimestamp: DROP,
      now: () => now,
      locked: btn,
      ticker,
      dualDefenseReload: true,
      onEmergencyReload,
      onDone: () => {},
    });

    while (now < DROP + 350 && ticker.running) {
      now += 10;
      ticker.tick();
    }

    expect(onEmergencyReload).toHaveBeenCalled();
  });
});

