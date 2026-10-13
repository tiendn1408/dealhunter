import { describe, it, expect, beforeEach, vi } from "vitest";
import { startHunt, HuntOutcome, Ticker, HuntOptions } from "./hunt_engine";
import { elementResolver } from "./element_resolver";
import { humanClicker } from "./human_clicker";
import { isMajorMarketplace } from "./target_diagnostics";
import { getAdapterForUrl } from "../adapters";

// Regression tests for the engine/resolver audit findings (C1, C2, C3 and the post-audit
// engine issues). Each test reproduces a case where the extension clicked the wrong thing,
// clicked when it should not, or reported a success the site never gave.

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

function giveLayout() {
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ left: 10, top: 10, width: 80, height: 30, right: 90, bottom: 40, x: 10, y: 10, toJSON() {} }) as DOMRect;
  HTMLElement.prototype.scrollIntoView = () => {};
}

function hunt(locked: HTMLElement | null, extra: Partial<HuntOptions> = {}) {
  let now = DROP - 5000;
  const ticker = new ManualTicker();
  let outcome: HuntOutcome | null = null;
  startHunt({
    targetTimestamp: DROP,
    now: () => now,
    locked,
    ticker,
    windowMs: 3000,
    onDone: (o) => (outcome = o),
    ...extra,
  });
  return {
    advanceTo(t: number, step = 10) {
      while (now < t && ticker.running) {
        now += step;
        ticker.tick();
      }
    },
    get now() {
      return now;
    },
    get outcome() {
      return outcome as HuntOutcome | null;
    },
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  sessionStorage.clear();
  giveLayout();
});

describe("C2: relocating the picked target never lands on another button", () => {
  it("buttons without card text: a reorder does not move the target onto a neighbour", () => {
    document.body.innerHTML = `<div><div><button>Lưu</button></div><div><button>Mua ngay</button></div></div>`;
    const picked = document.querySelector("button")!;
    const desc = elementResolver.describeUniversal(picked);

    // the list re-renders in another order
    document.body.innerHTML = `<div><div><button>Mua ngay</button></div><div><button>Lưu</button></div></div>`;
    const found = elementResolver.relocateUniversal(desc);
    expect(found?.textContent).toBe("Lưu");
  });

  it("two shops with the same voucher values: the picked shop's voucher is found after a reorder", () => {
    const card = (shop: string) =>
      `<div class="voucher-card"><span>${shop}</span><span>Giảm 50k</span><span>Đơn tối thiểu 0đ</span><button>Lưu</button></div>`;
    document.body.innerHTML = card("Shop Alpha Official") + card("Shop Beta Mall");
    const picked = document.querySelectorAll("button")[0];
    const desc = elementResolver.describeUniversal(picked);

    document.body.innerHTML = card("Shop Beta Mall") + card("Shop Alpha Official");
    const found = elementResolver.relocateUniversal(desc);
    expect(found?.closest(".voucher-card")?.textContent).toContain("Shop Alpha Official");
  });

  it("two indistinguishable candidates: nothing is chosen rather than guessing", () => {
    const card = `<div class="voucher-card"><span>Giảm 20k</span><button>Lưu</button></div>`;
    document.body.innerHTML = card;
    const desc = elementResolver.describeUniversal(document.querySelector("button")!);
    desc.id = undefined;
    desc.uniqueSelector = "#does-not-exist";
    desc.parentSelector = undefined;
    document.body.innerHTML = card + card;
    expect(elementResolver.relocateUniversal(desc)).toBeNull();
  });
});

describe("C3: automatic scanning never offers buy / checkout buttons", () => {
  it("a buy button with extra text is still excluded", () => {
    document.body.innerHTML = `<div class="card"><button>Mua ngay -50%</button><button>Thanh toán (2)</button><button>Lưu</button></div>`;
    const labels = elementResolver.findCollectButtons().map((b) => b.textContent);
    expect(labels).toEqual(["Lưu"]);
  });

  it("a hunt with only a keyword (no picked target) clicks nothing", () => {
    document.body.innerHTML = `<div class="voucher-card"><span>Giảm 500k</span><button id="b">Lưu</button></div>`;
    const clicks = vi.fn();
    document.getElementById("b")!.addEventListener("click", clicks);
    const h = hunt(null, { keyword: "500k" });
    h.advanceTo(DROP + 1000);
    expect(clicks).not.toHaveBeenCalled();
    expect(h.outcome?.result).toBe("not_found");
  });
});

describe("C1: success is only reported when the site really confirms it", () => {
  it("a button that is disabled while the request runs and then re-enabled is not 'saved'", () => {
    document.body.innerHTML = `<div class="voucher-card"><span>Giảm 50k</span><button id="b">Lưu</button></div>`;
    const btn = document.getElementById("b") as HTMLButtonElement;
    let reEnableAt = 0;
    btn.addEventListener("click", () => {
      btn.disabled = true;
      reEnableAt = h.now + 300; // the server answered "try again"
    });
    const h = hunt(btn);
    h.advanceTo(DROP + 20);
    expect(btn.disabled).toBe(true);
    h.advanceTo(reEnableAt);
    btn.disabled = false;
    h.advanceTo(DROP + 600);
    expect(h.outcome?.result).not.toBe("saved");
  });

  it("a status region that already had text before the click is not a confirmation", () => {
    document.body.innerHTML =
      `<div role="status">3 sản phẩm trong giỏ</div>` +
      `<div class="voucher-card"><span>Giảm 50k</span><button id="b">Lưu</button></div>`;
    const h = hunt(document.getElementById("b"));
    h.advanceTo(DROP + 1000);
    expect(h.outcome?.result).not.toBe("saved");
  });

  it("speed_priority: the page disabling again a button the engine unblocked is not 'saved'", () => {
    document.body.innerHTML = `<div class="voucher-card"><span>Đặt vé</span><button id="b" disabled>Đặt vé</button></div>`;
    const btn = document.getElementById("b") as HTMLButtonElement;
    btn.addEventListener("click", () => {
      btn.disabled = true; // React re-renders from its own state: still locked, nothing was sent
    });
    const h = hunt(btn, { platformTier: "speed_priority", preFireLeadMs: 0 });
    h.advanceTo(DROP + 1500);
    expect(h.outcome?.result).not.toBe("saved");
  });

  it("a real, lasting confirmation is still reported as saved", () => {
    document.body.innerHTML = `<div class="voucher-card"><span>Giảm 50k</span><button id="b">Lưu</button></div>`;
    const btn = document.getElementById("b") as HTMLButtonElement;
    btn.addEventListener("click", () => {
      btn.textContent = "Đã lưu";
      btn.disabled = true;
    });
    const h = hunt(btn);
    h.advanceTo(DROP + 1500);
    expect(h.outcome?.result).toBe("saved");
    expect(h.outcome?.clicks).toBe(1);
  });
});

describe("first click and early clicks", () => {
  it("never clicks a target that already shows sold out", () => {
    document.body.innerHTML = `<div class="voucher-card soldout"><span>Giảm 50k</span><button id="b" class="soldout">Hết lượt</button></div>`;
    const clicks = vi.fn();
    const btn = document.getElementById("b")!;
    btn.addEventListener("click", clicks);
    const h = hunt(btn, { platformTier: "speed_priority", preFireLeadMs: 0 });
    h.advanceTo(DROP + 3000);
    expect(clicks).not.toHaveBeenCalled();
    expect(h.outcome?.result).toBe("exhausted");
  });

  it("speed_priority: at most one click lands before the drop", () => {
    document.body.innerHTML = `<div class="card"><span>Đặt vé</span><button id="b">Đặt vé</button></div>`;
    const btn = document.getElementById("b")!;
    const at: number[] = [];
    const h = hunt(btn, { platformTier: "speed_priority", preFireLeadMs: 180 });
    btn.addEventListener("click", () => at.push(h.now));
    h.advanceTo(DROP + 400, 5);
    expect(at.filter((t) => t < DROP).length).toBeLessThanOrEqual(1);
    expect(at.length).toBeGreaterThan(1);
  });

  it("Tiki is a major marketplace (no early or forced clicks)", () => {
    expect(isMajorMarketplace("https://tiki.vn/khuyen-mai")).toBe(true);
  });
});

describe("dead-click reload", () => {
  it("does not reload while the first click's request may still be in flight", () => {
    document.body.innerHTML = `<div class="card"><span>Đặt vé</span><button id="b" disabled>Đặt vé</button></div>`;
    const btn = document.getElementById("b")!;
    const reload = vi.fn();
    let clickedAt = 0;
    // preReloadLeadMs 0: no pre-drop reload, only the dead-click recovery is under test
    const h = hunt(btn, { platformTier: "speed_priority", preFireLeadMs: 0, preReloadLeadMs: 0, dualDefenseReload: true, onEmergencyReload: reload });
    btn.addEventListener("click", () => (clickedAt = clickedAt || h.now));
    h.advanceTo(DROP + 400);
    expect(clickedAt).toBeGreaterThan(0);
    expect(reload).not.toHaveBeenCalled();
  });

  it("after a reload that followed our click, the saved state is our success, not something to click again", () => {
    sessionStorage.setItem(`dh_clicked_${DROP}`, "1");
    sessionStorage.setItem(`dh_reload_count_${DROP}`, "1");
    document.body.innerHTML = `<div class="card"><span>Đặt vé</span><button id="b" class="is-saved">Đã đặt</button></div>`;
    const btn = document.getElementById("b")!;
    const clicks = vi.fn();
    btn.addEventListener("click", clicks);
    const h = hunt(btn, { platformTier: "speed_priority", preFireLeadMs: 0 });
    h.advanceTo(DROP + 1500);
    expect(clicks).not.toHaveBeenCalled();
    expect(h.outcome?.result).toBe("saved");
  });
});

describe("click safety", () => {
  it("a prepared strike is not dispatched onto a page overlay, even one whose class contains 'dh-'", () => {
    document.body.innerHTML = `<button id="b">Lưu</button><div class="modal dh-modal" id="ov">Captcha</div>`;
    const btn = document.getElementById("b")!;
    const clicks = vi.fn();
    btn.addEventListener("click", clicks);
    const spy = vi.spyOn(document, "elementFromPoint").mockReturnValue(document.getElementById("ov"));
    humanClicker.preWarmStrike(btn);
    expect(humanClicker.dispatchPreWarmedStrike(btn)).toBe(false);
    expect(humanClicker.dispatchClick(btn)).toBe(false);
    expect(clicks).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("adapters match the site's host, not a URL that merely mentions it", () => {
    expect(getAdapterForUrl("https://example.com/?ref=shopee.vn")).toBeNull();
    expect(getAdapterForUrl("https://notlazada.example/lazada.vn")).toBeNull();
    expect(getAdapterForUrl("https://shopee.vn/m/ma-giam-gia")?.platformName).toBe("shopee");
    expect(getAdapterForUrl("https://www.lazada.vn/")?.platformName).toBe("lazada");
  });
});
