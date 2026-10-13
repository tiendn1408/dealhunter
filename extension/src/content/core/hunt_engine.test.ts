import { describe, it, expect, beforeEach, vi } from "vitest";
import { startHunt, HuntOutcome, Ticker } from "./hunt_engine";
import { elementResolver } from "./element_resolver";

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

function setup(keyword?: string, locked?: HTMLElement | null, windowMs = 3000) {
  let now = DROP - 5000;
  const ticker = new ManualTicker();
  let outcome: HuntOutcome | null = null;
  startHunt({ targetTimestamp: DROP, now: () => now, keyword, locked, ticker, windowMs, onDone: (o) => (outcome = o) });
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
    sessionStorage.clear();
    giveLayout();
  });

  it("does not click before the drop window", () => {
    document.body.innerHTML = voucherCard("v1", "Giảm 50k đơn 500k");
    const clicks = vi.fn();
    const btn = document.getElementById("v1")!;
    btn.addEventListener("click", clicks);
    const h = setup(undefined, btn);
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
    expect(h.outcome!.clicks).toBeLessThanOrEqual(200);
  });

  it("a keyword alone never makes the engine pick a button (only the user's picked target is clicked)", () => {
    document.body.innerHTML =
      voucherCard("small", "Giảm 10k đơn 99k") + voucherCard("big", "Giảm 500k đơn 2tr");
    const any = vi.fn();
    document.querySelectorAll("button").forEach((b) => b.addEventListener("click", any));
    const h = setup("500k");
    h.advanceTo(DROP + 1000);
    expect(h.outcome?.result).toBe("not_found");
    expect(any).not.toHaveBeenCalled();
  });

  it("starts clicking the picked voucher when it only appears after the drop", () => {
    document.body.innerHTML = voucherCard("late", "Giảm 50k đơn 500k");
    const desc = elementResolver.describeUniversal(document.getElementById("late")!);
    document.body.innerHTML = "";
    let now = DROP - 5000;
    const ticker = new ManualTicker();
    let outcome: HuntOutcome | null = null;
    startHunt({ targetTimestamp: DROP, now: () => now, universalDescriptor: desc, ticker, windowMs: 3000, onDone: (o) => (outcome = o) });
    const advanceTo = (t: number) => {
      while (now < t && ticker.running) {
        now += 10;
        ticker.tick();
      }
    };
    advanceTo(DROP + 300);
    document.body.innerHTML = voucherCard("late", "Giảm 50k đơn 500k");
    const late = document.getElementById("late")!;
    late.addEventListener("click", () => (late.textContent = "Đã lưu"));
    advanceTo(DROP + 1500);
    expect((outcome as HuntOutcome | null)?.result).toBe("saved");
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

    // Only turning disabled is a weak signal (also happens while a request runs): it must last
    h.advanceTo(DROP + 500);
    expect(freshClicks).toHaveBeenCalled();
    expect(h.outcome).toBeNull();
    h.advanceTo(DROP + 2200);
    expect(h.outcome?.result).toBe("saved");
  });

  it("completes immediately when a custom button text changes to completed after click", () => {
    document.body.innerHTML = `<div class="event"><button id="claim-btn">Check In</button></div>`;
    const btn = document.getElementById("claim-btn")!;
    btn.addEventListener("click", () => {
      btn.textContent = "Checked in";
    });
    const h = setup(undefined, btn);
    h.advanceTo(DROP + 500); // the new text has to hold for a moment

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

  it("paces clicks according to the stealth human biometric profile", () => {
    document.body.innerHTML = `<div><button id="stealth-btn">Lưu</button></div>`;
    const btn = document.getElementById("stealth-btn")!;
    const clickTimestamps: number[] = [];
    btn.addEventListener("click", () => {
      clickTimestamps.push(now);
    });

    let now = DROP;
    const ticker = new ManualTicker();
    let outcome: HuntOutcome | null = null;
    startHunt({
      targetTimestamp: DROP,
      now: () => now,
      locked: btn,
      ticker,
      clickProfileMode: "stealth",
      onDone: (o) => (outcome = o),
    });

    // Advance 600ms
    while (now < DROP + 600 && ticker.running) {
      now += 10;
      ticker.tick();
    }

    expect(clickTimestamps.length).toBeGreaterThanOrEqual(2);
    expect(clickTimestamps.length).toBeLessThanOrEqual(6); // Stealth profile runs ~6-8 CPS, not 20+ CPS
    // Verify interval between first two clicks is >= 90ms (biological human delay)
    if (clickTimestamps.length >= 2) {
      const delta = clickTimestamps[1] - clickTimestamps[0];
      expect(delta).toBeGreaterThanOrEqual(90);
    }
  });

  it("executes turbo mode with high-speed Gaussian bursts", () => {
    document.body.innerHTML = `<div><button id="turbo-btn">Lưu</button></div>`;
    const btn = document.getElementById("turbo-btn")!;
    const clickTimestamps: number[] = [];
    btn.addEventListener("click", () => {
      clickTimestamps.push(now);
    });

    let now = DROP;
    const ticker = new ManualTicker();
    startHunt({
      targetTimestamp: DROP,
      now: () => now,
      locked: btn,
      ticker,
      clickProfileMode: "turbo",
      onDone: () => {},
    });

    // Advance 400ms
    while (now < DROP + 400 && ticker.running) {
      now += 10;
      ticker.tick();
    }

    // In turbo mode, it should fire more clicks than stealth in 400ms
    expect(clickTimestamps.length).toBeGreaterThanOrEqual(5);
  });

  it("C1-a: does not report saved on click 1 when target text simply transitioned from pre-drop label", () => {
    document.body.innerHTML = voucherCard("v1", "Giảm 50k", "Sắp mở");
    const btn = document.getElementById("v1")!;
    let clicked = 0;
    btn.addEventListener("click", () => {
      clicked++;
      // Button still says 'Lưu', server has not confirmed yet!
    });

    let now = DROP - 1000;
    const ticker = new ManualTicker();
    let outcome: HuntOutcome | null = null;
    startHunt({
      targetTimestamp: DROP,
      now: () => now,
      locked: btn,
      ticker,
      onDone: (o) => (outcome = o),
    });

    // Before drop, it was 'Sắp mở'. At drop, countdown ends and page changes button to 'Lưu':
    now = DROP;
    btn.textContent = "Lưu";
    ticker.tick(); // click 1 dispatched

    expect(clicked).toBe(1);
    // Must NOT be reported as saved yet because transition from 'Sắp mở' to 'Lưu' was pre-drop unlock!
    expect(outcome).toBeNull();
  });

  it("C3: startHunt does not click arbitrary buttons when no target is locked", () => {
    document.body.innerHTML = `
      <div class="card">
        <button id="buy-btn">Mua ngay</button>
      </div>
    `;
    const buyBtn = document.getElementById("buy-btn")!;
    const clickFn = vi.fn();
    buyBtn.addEventListener("click", clickFn);

    let now = DROP;
    const ticker = new ManualTicker();
    let outcome: HuntOutcome | null = null;
    startHunt({
      targetTimestamp: DROP,
      now: () => now,
      // NO locked target
      ticker,
      onDone: (o) => (outcome = o),
    });

    ticker.tick();
    expect(clickFn).not.toHaveBeenCalled();
    expect((outcome as HuntOutcome | null)?.result).toBe("not_found");
  });

  it("M4: aborts hunt with cancelled if page navigates to different URL during hunt (SPA pushState)", () => {
    window.history.pushState({}, "", "/flash_sale");
    document.body.innerHTML = `
      <div id="card">
        <button id="target-btn">LƯU</button>
      </div>
    `;
    const btn = document.getElementById("target-btn") as HTMLElement;

    let now = DROP;
    const ticker = new ManualTicker();
    let outcome: HuntOutcome | null = null;

    startHunt({
      targetTimestamp: DROP,
      now: () => now,
      locked: btn,
      ticker,
      onDone: (o) => (outcome = o),
    });

    // Simulate SPA navigation to cart before tick
    window.history.pushState({}, "", "/cart");

    ticker.tick();
    expect(outcome).not.toBeNull();
    expect((outcome as any)?.result).toBe("cancelled");
    expect((outcome as any)?.detail).toContain("Page navigated away");
  });

  it("M6: catches unexpected exception in tick and finishes safely without hanging loop", () => {
    window.history.pushState({}, "", "/event");
    document.body.innerHTML = `
      <div id="card">
        <button id="target-btn">LƯU</button>
      </div>
    `;
    const btn = document.getElementById("target-btn") as HTMLElement;

    // Simulate a crashing scrollIntoView or resolve
    btn.scrollIntoView = () => {
      throw new Error("Simulated DOM crash in tick");
    };

    let now = DROP - 1000;
    const ticker = new ManualTicker();
    let outcome: HuntOutcome | null = null;

    startHunt({
      targetTimestamp: DROP,
      now: () => now,
      locked: btn,
      leadMs: 2000,
      ticker,
      onDone: (o) => (outcome = o),
    });

    // Tick should not throw unhandled exception
    expect(() => ticker.tick()).not.toThrow();
  });

  it("resumes hunt started after drop time with expanded windowMs", () => {
    document.body.innerHTML = voucherCard("v1", "Giảm 50k đơn 500k");
    const btn = document.getElementById("v1")!;
    let clickCount = 0;
    btn.addEventListener("click", () => {
      clickCount++;
    });

    // Start hunt at DROP + 3500ms (e.g. after page reload)
    let now = DROP + 3500;
    const ticker = new ManualTicker();
    let outcome: HuntOutcome | null = null;

    startHunt({
      targetTimestamp: DROP,
      now: () => now,
      locked: btn,
      ticker,
      onDone: (o) => (outcome = o),
    });

    // Tick 1 at DROP + 3500ms: must NOT timeout or report not_found
    ticker.tick();
    expect(outcome).toBeNull();
    expect(clickCount).toBe(1);

    // Advance 5000ms more (now = DROP + 8500ms): should still be active
    for (let i = 0; i < 50; i++) {
      now += 100;
      ticker.tick();
    }
    expect(outcome).toBeNull();
    expect(clickCount).toBeGreaterThan(1);
  });

  it("scrolls toward documentTop when target element is not in DOM upon reload", () => {
    let scrolledTo: { top: number; behavior?: string } | null = null;
    window.scrollTo = (options: any) => {
      scrolledTo = options;
    };
    (window as any).scrollY = 0;

    let now = DROP;
    const ticker = new ManualTicker();

    startHunt({
      targetTimestamp: DROP,
      now: () => now,
      universalDescriptor: {
        uniqueSelector: "#lazy-voucher-btn",
        tagName: "button",
        attributes: {},
        initialText: "Lưu",
        documentTop: 2400,
      },
      ticker,
      onDone: () => {},
    });

    // Tick at drop time when element is not in DOM
    ticker.tick();

    expect(scrolledTo).not.toBeNull();
    expect((scrolledTo as any)?.top).toBe(2150); // 2400 - 250
  });

  it("completes hunt immediately as saved when page toast appears after clicks", () => {
    document.body.innerHTML = voucherCard("v1", "Giảm 50k");
    const btn = document.getElementById("v1")!;
    let now = DROP;
    const ticker = new ManualTicker();
    let outcome: HuntOutcome | null = null;

    startHunt({
      targetTimestamp: DROP,
      now: () => now,
      locked: btn,
      ticker,
      onDone: (o) => (outcome = o),
    });

    // Click 1 dispatched
    ticker.tick();
    expect(outcome).toBeNull();

    // Shopee displays toast notification with success icon
    const toast = document.createElement("div");
    toast.className = "shopee-toast is-success";
    toast.innerHTML = '<svg class="icon-success"></svg><span>Voucher Saved</span>';
    document.body.appendChild(toast);

    // Next ticks: the confirmation has to hold for a moment
    now += 100;
    ticker.tick();
    expect(outcome).toBeNull();
    now += 350;
    ticker.tick();

    expect(outcome).not.toBeNull();
    expect((outcome as HuntOutcome | null)?.result).toBe("saved");
    expect((outcome as HuntOutcome | null)?.detail).toContain("Page notification confirmed success via structural icon or data contract");
  });

  it("pre-warms socket via keepalive HEAD ping at T - 5s in speed priority mode", () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response());
    vi.stubGlobal("fetch", fetchSpy);

    let now = DROP - 4000; // T - 4s (within [5000, 1000])
    const ticker = new ManualTicker();
    const btn = document.createElement("button");
    btn.textContent = "Điểm danh";
    document.body.appendChild(btn);

    startHunt({
      targetTimestamp: DROP,
      now: () => now,
      locked: btn,
      platformTier: "speed_priority",
      ticker,
      onDone: () => {},
    });

    ticker.tick();
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: "HEAD", cache: "no-store", keepalive: true })
    );

    vi.unstubAllGlobals();
  });

  it("triggers precision pre-reload at T - 750ms if button is still disabled or stale in speed priority", () => {
    let now = DROP - 700; // T - 700ms
    const ticker = new ManualTicker();
    const btn = document.createElement("button");
    btn.setAttribute("disabled", "true");
    btn.textContent = "Điểm danh";
    document.body.appendChild(btn);

    const reloadSpy = vi.fn();

    startHunt({
      targetTimestamp: DROP,
      now: () => now,
      locked: btn,
      platformTier: "speed_priority",
      onEmergencyReload: reloadSpy,
      ticker,
      onDone: () => {},
    });

    ticker.tick();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(`dh_reload_count_${DROP}`)).toBe("1");

    sessionStorage.clear();
  });

  it("does not trigger pre-reload if dualDefenseReload is explicitly set to false", () => {
    let now = DROP - 700;
    const ticker = new ManualTicker();
    const btn = document.createElement("button");
    btn.setAttribute("disabled", "true");
    btn.textContent = "Điểm danh";
    document.body.appendChild(btn);

    const reloadSpy = vi.fn();

    startHunt({
      targetTimestamp: DROP,
      now: () => now,
      locked: btn,
      platformTier: "speed_priority",
      dualDefenseReload: false,
      onEmergencyReload: reloadSpy,
      ticker,
      onDone: () => {},
    });

    ticker.tick();
    expect(reloadSpy).not.toHaveBeenCalled();
    sessionStorage.clear();
  });

  it("triggers pre-reload at custom configured preReloadLeadMs (e.g. T - 1500ms)", () => {
    let now = DROP - 1400; // T - 1400ms is within [T - 1500, T - 1100]
    const ticker = new ManualTicker();
    const btn = document.createElement("button");
    btn.setAttribute("disabled", "true");
    btn.textContent = "Điểm danh";
    document.body.appendChild(btn);

    const reloadSpy = vi.fn();

    startHunt({
      targetTimestamp: DROP,
      now: () => now,
      locked: btn,
      platformTier: "speed_priority",
      preReloadLeadMs: 1500,
      onEmergencyReload: reloadSpy,
      ticker,
      onDone: () => {},
    });

    ticker.tick();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(`dh_reload_count_${DROP}`)).toBe("1");

    sessionStorage.clear();
  });

  it("fires pre-emptive click and forcibly unblocks disabled attributes at T - preFireLeadMs", () => {
    let now = DROP - 25; // Pre-fire lead is 28ms -> T - 25ms is >= T - 28ms
    const ticker = new ManualTicker();
    const btn = document.createElement("button");
    btn.setAttribute("disabled", "true");
    btn.setAttribute("aria-disabled", "true");
    btn.classList.add("disabled");
    btn.textContent = "Điểm danh";
    document.body.appendChild(btn);

    const clickSpy = vi.fn(() => {
      btn.textContent = "Đã điểm danh";
    });
    btn.addEventListener("click", clickSpy);

    let outcome: HuntOutcome | null = null;
    startHunt({
      targetTimestamp: DROP,
      now: () => now,
      locked: btn,
      platformTier: "speed_priority",
      preFireLeadMs: 28,
      ticker,
      onDone: (o) => (outcome = o),
    });

    ticker.tick();

    // Attribute disabled must be unblocked immediately
    expect(btn.hasAttribute("disabled")).toBe(false);
    expect(btn.getAttribute("aria-disabled")).toBe("false");
    expect(btn.classList.contains("disabled")).toBe(false);

    // Click must be dispatched immediately
    expect(clickSpy).toHaveBeenCalledTimes(1);

    // When text transitions to 'Đã điểm danh' and stays, it finishes saved
    now += 50;
    ticker.tick();
    now += 350;
    ticker.tick();
    expect((outcome as HuntOutcome | null)?.result).toBe("saved");
  });

  it("executes guarded reload loop up to 3 times after drop if button remains in yesterday's saved state", () => {
    let now = DROP + 300;
    const ticker = new ManualTicker();
    const btn = document.createElement("button");
    btn.setAttribute("data-state", "saved");
    btn.textContent = "Đã điểm danh";
    document.body.appendChild(btn);

    const reloadSpy = vi.fn();

    startHunt({
      targetTimestamp: DROP,
      now: () => now,
      locked: btn,
      platformTier: "speed_priority",
      dualDefenseReload: true,
      onEmergencyReload: reloadSpy,
      ticker,
      onDone: () => {},
    });

    ticker.tick();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(`dh_reload_count_${DROP}`)).toBe("1");

    sessionStorage.clear();
  });

  it("speed_priority caps clicks to speedPriorityMaxClicks (6) and closes within 2000ms window without spamming", () => {
    let now = DROP - 28;
    const ticker = new ManualTicker();
    const btn = document.createElement("button");
    btn.textContent = "Điểm danh";
    document.body.appendChild(btn);

    let clickCount = 0;
    btn.addEventListener("click", () => {
      clickCount++;
    });

    let outcome: HuntOutcome | null = null;
    startHunt({
      targetTimestamp: DROP,
      now: () => now,
      locked: btn,
      platformTier: "speed_priority",
      ticker,
      onDone: (o) => (outcome = o),
    });

    // Advance 3000ms (beyond 2000ms window) with 10ms ticks
    for (let i = 0; i < 300; i++) {
      now += 10;
      ticker.tick();
    }

    // Must cap at exactly 6 clicks and never spam up to 66 clicks!
    expect(clickCount).toBe(6);
    const finalOutcome = outcome as HuntOutcome | null;
    expect(finalOutcome?.result).toBe("timeout");
    expect(finalOutcome?.clicks).toBe(6);
    expect(finalOutcome?.detail).toContain("Hyper burst dispatched (6 clicks)");
  });

  it("triggers guarded reload after probe click if button remains disabled or stale in speed_priority (Dead Click Recovery)", () => {
    let now = DROP - 28;
    const ticker = new ManualTicker();
    const btn = document.createElement("button");
    btn.textContent = "Điểm danh";
    btn.setAttribute("disabled", "true");
    document.body.appendChild(btn);

    const reloadSpy = vi.fn();

    startHunt({
      targetTimestamp: DROP,
      now: () => now,
      locked: btn,
      platformTier: "speed_priority",
      dualDefenseReload: true,
      onEmergencyReload: reloadSpy,
      ticker,
      onDone: () => {},
    });

    // Fire probe click at T - 28ms
    ticker.tick();

    // Probe click fired, but the page re-disabled the button and nothing answered: after enough
    // time for the request to come back (DEAD_CLICK_MS), reload
    btn.setAttribute("disabled", "true");
    now = DROP + 180;
    ticker.tick();
    expect(reloadSpy).not.toHaveBeenCalled();
    now = DROP + 650;
    ticker.tick();

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(`dh_reload_count_${DROP}`)).toBe("1");

    sessionStorage.clear();
  });
});



