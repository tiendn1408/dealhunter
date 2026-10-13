import { describe, it, expect, beforeEach, vi } from "vitest";
import { getAdapterForUrl, ADAPTERS, CaffiliateAdapter } from "./index";
import { isECommerceVoucherOrDealPage, isECommerceProductPage } from "../index";
import { detectPlatformBlock } from "../platform_block";

describe("Marketplace Adapters & Multi-Platform Registry", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("registers all core e-commerce marketplace adapters", () => {
    const names = ADAPTERS.map((a) => a.platformName);
    expect(names).toContain("shopee");
    expect(names).toContain("lazada");
    expect(names).toContain("tiki");
    expect(names).toContain("tiktok");
  });

  it("resolves appropriate adapter for Shopee across regions", () => {
    expect(getAdapterForUrl("https://shopee.vn/m/ma-giam-gia")?.platformName).toBe("shopee");
    expect(getAdapterForUrl("https://shopee.co.th/flash_sale")?.platformName).toBe("shopee");
    expect(getAdapterForUrl("https://shopee.sg/product/1/2")?.platformName).toBe("shopee");
  });

  it("resolves appropriate adapter for Lazada across regions", () => {
    expect(getAdapterForUrl("https://www.lazada.vn/voucher")?.platformName).toBe("lazada");
    expect(getAdapterForUrl("https://www.lazada.co.th/wow/gcp")?.platformName).toBe("lazada");
    expect(getAdapterForUrl("https://www.lazada.com.ph/products/x-i1-s2.html")?.platformName).toBe("lazada");
  });

  it("resolves appropriate adapter for Tiki", () => {
    expect(getAdapterForUrl("https://tiki.vn/khuyen-mai/ma-giam-gia")?.platformName).toBe("tiki");
    expect(getAdapterForUrl("https://tiki.vn/san-pham-p12345.html")?.platformName).toBe("tiki");
  });

  it("resolves appropriate adapter for TikTok Shop", () => {
    expect(getAdapterForUrl("https://shop.tiktok.com/view/product/123456")?.platformName).toBe("tiktok");
    expect(getAdapterForUrl("https://www.tiktok.com/@creator/video/123")?.platformName).toBe("tiktok");
  });

  it("resolves appropriate adapter for Caffiliate and disables destructive reload", () => {
    const adapter = getAdapterForUrl("https://app.caffiliate.vn/rewards");
    expect(adapter).not.toBeNull();
    expect(adapter?.platformName).toBe("caffiliate");
    expect(adapter?.shouldDisableReload?.()).toBe(true);
    expect(adapter?.maxClicks).toBe(1);
    expect(adapter?.windowMs).toBe(8000);

    // Only the real caffiliate.vn host: not a URL that merely mentions it, not other local apps...
    expect(getAdapterForUrl("https://www.google.com/search?q=caffiliate.vn")).toBeNull();
    expect(getAdapterForUrl("http://localhost:3000/")).toBeNull();
    expect(getAdapterForUrl("https://example.com/?next=localhost:3100")).toBeNull();
    // ...but the local Caffiliate Bench simulator is
    expect(getAdapterForUrl("http://localhost:3100/")?.platformName).toBe("caffiliate");
    expect(getAdapterForUrl("http://127.0.0.1:3100/bench")?.platformName).toBe("caffiliate");
    expect(getAdapterForUrl("https://evil-caffiliate.vn/")).toBeNull();
  });

  it("detects Turnstile challenge pending and overrides status prompt", () => {
    const adapter = getAdapterForUrl("https://app.caffiliate.vn/rewards") as any;
    expect(adapter).not.toBeNull();
    expect(adapter.isTurnstilePending()).toBe(false);
    expect(adapter.getStatusOverride()).toBeNull();

    // Trigger via data-dh-turnstile-challenge attribute
    document.documentElement.setAttribute("data-dh-turnstile-challenge", "active");
    expect(adapter.isTurnstilePending()).toBe(true);
    expect(adapter.getStatusOverride()).toContain("Cloudflare");
    document.documentElement.removeAttribute("data-dh-turnstile-challenge");
    expect(adapter.isTurnstilePending()).toBe(false);

    // Trigger via Cloudflare iframe selector in DOM
    const origQuery = document.querySelector.bind(document);
    const spy = vi.spyOn(document, "querySelector").mockImplementation((sel: string) => {
      if (sel.includes("challenges.cloudflare.com")) return document.createElement("iframe") as any;
      return origQuery(sel);
    });
    expect(adapter.isTurnstilePending()).toBe(true);
    expect(adapter.getStatusOverride()).toContain("Cloudflare");
    expect(adapter.getStatusOverride("vi")).toContain("Xác minh bảo mật Cloudflare");
    expect(adapter.getStatusOverride("en")).toContain("Cloudflare Security Verification");
    spy.mockRestore();
    expect(adapter.isTurnstilePending()).toBe(false);
  });

  it("finds primary check-in button and verifies completion state on Caffiliate", () => {
    const adapter = getAdapterForUrl("https://app.caffiliate.vn/rewards");
    expect(adapter).not.toBeNull();

    // Setup DOM with real button and static "Xèng Của Bạn" text
    document.body.innerHTML = `
      <div id="rewards-container">
        <div id="xeng-card" class="xeng-card">
          <span id="xeng-label">Xèng Của Bạn</span>
          <span id="xeng-count">100 Xu</span>
        </div>
        <button id="btnCheckIn" class="pointer-events-none disabled" disabled>
          <span id="btnCheckInText">Điểm danh</span>
        </button>
      </div>
    `;

    const realBtn = document.getElementById("btnCheckIn") as HTMLElement;

    // Finding buttons finds the real button
    const buttons = adapter?.findVoucherButtons();
    expect(buttons).toContain(realBtn);

    // Initial button not finished
    expect(adapter?.isButtonFinished(realBtn)).toBe(false);

    // Finished button
    realBtn.innerHTML = "<span>Đã điểm danh #1</span>";
    expect(adapter?.isButtonFinished(realBtn)).toBe(true);

    // A page-set flag or any popup (including an error popup) is not a confirmation
    document.body.innerHTML = `
      <button id="btnCheckIn"><span>Điểm danh</span></button>
      <div class="swal2-container"><div class="swal2-popup">Chưa tới giờ điểm danh</div></div>
      <div>Hạng hôm nay</div>
    `;
    document.documentElement.setAttribute("data-dh-checked-in", "true");
    expect(adapter?.isButtonFinished(document.getElementById("btnCheckIn") as HTMLElement)).toBe(false);
    document.documentElement.removeAttribute("data-dh-checked-in");
  });

  it("dynamically discovers check-in button on Caffiliate even if ID changes", () => {
    const adapter = getAdapterForUrl("https://app.caffiliate.vn/rewards");
    expect(adapter).not.toBeNull();

    // DOM with mutated ID and text matching
    document.body.innerHTML = `
      <div>
        <button id="custom-dynamic-btn" class="pointer-events-none disabled" disabled>
          <span>Điểm danh (+50)</span>
        </button>
      </div>
    `;

    const dynamicBtn = document.getElementById("custom-dynamic-btn") as HTMLElement;
    const buttons = adapter?.findVoucherButtons();
    expect(buttons).toContain(dynamicBtn);
  });

  it("pre-drop hook only preconnects and never unblocks or alters the page", () => {
    const adapter = getAdapterForUrl("https://app.caffiliate.vn/rewards");
    document.body.innerHTML = `<button id="btnCheckIn" class="disabled" disabled><span>Điểm danh</span></button>`;
    const realBtn = document.getElementById("btnCheckIn") as HTMLButtonElement;

    adapter?.preWarmStrike?.();
    adapter?.preWarmStrike?.();

    expect(realBtn.disabled).toBe(true);
    expect(realBtn.classList.contains("disabled")).toBe(true);
    expect(document.querySelectorAll('link[rel="preconnect"][href="https://challenges.cloudflare.com"]').length).toBe(1);
  });

  it("stores each check-in run for the popup Log tab, newest first", async () => {
    const store: Record<string, any> = {};
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: store[key] })),
          set: vi.fn(async (items: Record<string, any>) => Object.assign(store, items)),
        },
      },
    });
    const adapter = getAdapterForUrl("https://app.caffiliate.vn/rewards") as CaffiliateAdapter;
    adapter.listenForTimings();
    const run = {
      startAt: 1_000,
      source: "strike",
      ok: true,
      method: "page confirmed",
      attempts: [
        {
          n: 1,
          startAt: 1_000,
          tiers: [{ tier: 1, ok: true, name: "checkIn()" }],
          tokenStartAt: 1_004,
          tokenEndAt: 1_824,
          requestStartAt: 1_830,
          responseAt: 1_925,
          status: 200,
        },
      ],
    };
    window.dispatchEvent(new CustomEvent("dh-checkin-timing", { detail: JSON.stringify(run) }));
    window.dispatchEvent(new CustomEvent("dh-checkin-timing", { detail: "{oops" })); // ignored
    await vi.waitFor(() => expect(store.dh_checkin_logs?.length).toBe(1));

    const [entry] = store.dh_checkin_logs;
    expect(entry).toMatchObject({ ok: true, host: window.location.hostname, source: "strike" });
    expect(entry.attempts[0]).toMatchObject({ n: 1, tokenMs: 820, sentAfterMs: 830, serverMs: 95, status: 200 });
    expect(entry.attempts[0].start).toMatch(/^\d\d:\d\d:\d\d\.\d{3}$/);
    vi.unstubAllGlobals();
  });

  it("strikes through the page helper and finishes only on its confirmed result", () => {
    const adapter = getAdapterForUrl("https://app.caffiliate.vn/rewards") as CaffiliateAdapter;
    document.body.innerHTML = `<button id="btnCheckIn" disabled><span>Điểm danh</span></button>`;
    const btn = document.getElementById("btnCheckIn") as HTMLButtonElement;
    adapter.preWarmStrike();

    const strikes = vi.fn();
    window.addEventListener("dh-caffiliate-strike", strikes);
    expect(adapter.executeDirectStrike()).toBe(true);
    window.removeEventListener("dh-caffiliate-strike", strikes);
    expect(strikes).toHaveBeenCalledTimes(1);
    expect(btn.disabled).toBe(true); // the button is not touched

    window.dispatchEvent(new CustomEvent("dh-checkin-result", { detail: JSON.stringify({ ok: false }) }));
    expect(adapter.isButtonFinished(btn)).toBe(false);
    window.dispatchEvent(new CustomEvent("dh-checkin-result", { detail: JSON.stringify({ ok: true, method: "checkIn" }) }));
    expect(adapter.isButtonFinished(btn)).toBe(true);
    adapter.preWarmStrike(); // next hunt starts unconfirmed
    expect(adapter.isButtonFinished(btn)).toBe(false);
  });

  it("returns null for non-marketplace domains", () => {
    expect(getAdapterForUrl("https://example.com/item/1")).toBeNull();
    expect(getAdapterForUrl("https://google.com")).toBeNull();
  });
});

describe("Multi-Platform Page Detection", () => {
  it("detects voucher, deal, and campaign pages across all platforms", () => {
    // Shopee
    expect(isECommerceVoucherOrDealPage("https://shopee.vn/m/ma-giam-gia")).toBe(true);
    expect(isECommerceVoucherOrDealPage("https://shopee.vn/m/10-10")).toBe(true);
    expect(isECommerceVoucherOrDealPage("https://shopee.vn/cart")).toBe(true);

    // Lazada
    expect(isECommerceVoucherOrDealPage("https://www.lazada.vn/voucher")).toBe(true);
    expect(isECommerceVoucherOrDealPage("https://www.lazada.vn/wow/gcp/route")).toBe(true);
    expect(isECommerceVoucherOrDealPage("https://cart.lazada.vn/cart")).toBe(true);

    // Tiki
    expect(isECommerceVoucherOrDealPage("https://tiki.vn/khuyen-mai/ma-giam-gia")).toBe(true);
    expect(isECommerceVoucherOrDealPage("https://tiki.vn/cart")).toBe(true);

    // TikTok Shop
    expect(isECommerceVoucherOrDealPage("https://shop.tiktok.com/campaign/super-deal")).toBe(true);
    expect(isECommerceVoucherOrDealPage("https://shop.tiktok.com/cart")).toBe(true);

    // Other sites: the HUD opens only from the popup there (decision 3)
    expect(isECommerceVoucherOrDealPage("https://retailer.com/flash-sale")).toBe(false);
    expect(isECommerceVoucherOrDealPage("https://retailer.com/ma-giam-gia")).toBe(false);
    expect(isECommerceVoucherOrDealPage("https://retailer.com/about-us")).toBe(false);
  });

  it("detects product detail pages for price intelligence across platforms", () => {
    // Shopee
    expect(isECommerceProductPage("https://shopee.vn/Product-Name-i.12345.67890")).toBe(true);
    expect(isECommerceProductPage("https://shopee.vn/product/12345/67890")).toBe(true);

    // Lazada
    expect(isECommerceProductPage("https://www.lazada.vn/products/headphone-sony-i12345-s67890.html")).toBe(true);

    // Tiki
    expect(isECommerceProductPage("https://tiki.vn/dien-thoai-thong-minh-p1234567.html")).toBe(true);

    // TikTok Shop
    expect(isECommerceProductPage("https://shop.tiktok.com/view/product/17293847583920192")).toBe(true);

    // Not product page
    expect(isECommerceProductPage("https://shopee.vn/search?keyword=phone")).toBe(false);
    expect(isECommerceProductPage("https://www.lazada.vn/catalog/")).toBe(false);
    expect(isECommerceProductPage("https://tiki.vn/")).toBe(false);
  });
});

describe("detectPlatformBlock", () => {
  it("identifies Shopee verification and login redirect", () => {
    expect(detectPlatformBlock("https://shopee.vn/verify/traffic")).toEqual({ site: "Shopee", kind: "verify" });
    expect(detectPlatformBlock("https://shopee.vn/buyer/login")).toEqual({ site: "Shopee", kind: "signin" });
  });

  it("identifies Lazada verification and login redirect", () => {
    expect(detectPlatformBlock("https://member.lazada.vn/user/login")).toEqual({ site: "Lazada", kind: "signin" });
    expect(detectPlatformBlock("https://www.lazada.vn/verification/punish")).toEqual({ site: "Lazada", kind: "verify" });
  });

  it("identifies Tiki login redirect", () => {
    expect(detectPlatformBlock("https://tiki.vn/customer/account/login")).toEqual({ site: "Tiki", kind: "signin" });
  });

  it("identifies TikTok Shop verification and login redirect", () => {
    expect(detectPlatformBlock("https://shop.tiktok.com/login")).toEqual({ site: "TikTok Shop", kind: "signin" });
    expect(detectPlatformBlock("https://shop.tiktok.com/verify")).toEqual({ site: "TikTok Shop", kind: "verify" });
  });

  it("returns null for normal campaign and voucher pages", () => {
    expect(detectPlatformBlock("https://shopee.vn/m/ma-giam-gia")).toBeNull();
    expect(detectPlatformBlock("https://www.lazada.vn/voucher")).toBeNull();
  });
});
