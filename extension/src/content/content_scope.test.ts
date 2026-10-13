import { describe, it, expect, vi, beforeEach } from "vitest";
import { isECommerceVoucherOrDealPage, isECommerceProductPage } from "./index";
import { TimeSyncClient } from "./core/time_sync_client";
import { isPriceContextUrl } from "../lib/url";

// Decision 3: the extension works only on pages that need it. The HUD does not open by itself on
// unknown sites, the price badge (and the API call with the member's token) only on marketplace
// product pages, and the clock is not probed on pages without a hunt.

describe("where the HUD opens by itself", () => {
  it("marketplace voucher / deal pages", () => {
    expect(isECommerceVoucherOrDealPage("https://shopee.vn/m/ma-giam-gia")).toBe(true);
    expect(isECommerceVoucherOrDealPage("https://www.lazada.vn/voucher")).toBe(true);
    expect(isECommerceVoucherOrDealPage("https://tiki.vn/khuyen-mai/ma-giam-gia")).toBe(true);
  });

  it("not on unknown sites, nor on paths that merely start like a deal path", () => {
    expect(isECommerceVoucherOrDealPage("https://retailer.com/flash-sale")).toBe(false);
    expect(isECommerceVoucherOrDealPage("https://github.com/foo/voucher-lib")).toBe(false);
    expect(isECommerceVoucherOrDealPage("https://shopee.vn/me")).toBe(false);
    expect(isECommerceVoucherOrDealPage("https://www.tiktok.com/messages")).toBe(false);
    expect(isECommerceVoucherOrDealPage("https://www.amazon.com/music")).toBe(false);
    expect(isECommerceVoucherOrDealPage("https://example.com/?r=shopee.vn/m/x")).toBe(false);
  });
});

describe("price badge", () => {
  it("only on marketplace product pages (the token is never sent for other sites)", () => {
    expect(isECommerceProductPage("https://shopee.vn/Ten-san-pham-i.123.456")).toBe(true);
    expect(isECommerceProductPage("https://evil.example/shopee.vn-i.1.2")).toBe(false);
    expect(isPriceContextUrl("https://shopee.vn/Ten-san-pham-i.123.456")).toBe(true);
    expect(isPriceContextUrl("https://evil.example/product/1/2")).toBe(false);
    expect(isPriceContextUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("clock sync on the page", () => {
  let sendMessage: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    sendMessage = vi.fn(async () => ({ calibration: null }));
    vi.stubGlobal("chrome", {
      runtime: { sendMessage },
      storage: { onChanged: { addListener: vi.fn() } },
    });
  });

  it("does not probe the site on focus / tab switch until a hunt or the HUD needs the clock", async () => {
    new TimeSyncClient();
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((r) => setTimeout(r, 0));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("once used, it keeps the page's clock fresh on focus", async () => {
    const client = new TimeSyncClient();
    await client.init();
    sendMessage.mockClear();
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 0));
    expect(sendMessage).toHaveBeenCalled();
  });
});
