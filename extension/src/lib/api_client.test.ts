import { describe, it, expect } from "vitest";
import { savingVsViewedSource } from "./api_client";

const shopee = { source_id: "s-shopee", platform: "shopee", canonical_url: "https://shopee.vn/x-i.1.2", effective_price: 200_000 };
const other = { source_id: "s-shopee-2", platform: "shopee", canonical_url: "https://shopee.vn/y-i.3.4", effective_price: 400_000 };
const lazada = { source_id: "s-laz", platform: "lazada", canonical_url: "https://lazada.vn/p", effective_price: 150_000 };

describe("savingVsViewedSource", () => {
  it("is relative to the viewed Shopee source, not the most expensive one", () => {
    // 150k vs the viewed 200k = 25% (vs the most expensive 400k it would be 62.5%)
    expect(savingVsViewedSource([shopee, other, lazada], { ProductSourceID: "s-shopee" }, 150_000, true)).toBe(25);
  });

  it("matches by shop/item IDs when the source ID is not available", () => {
    expect(
      savingVsViewedSource([other, shopee, lazada], { CanonicalURL: "https://shopee.vn/abc-i.1.2?sp=1" }, 150_000, true)
    ).toBe(25);
  });

  it("is unknown when the viewed source has no price", () => {
    expect(savingVsViewedSource([{ ...shopee, effective_price: null }, lazada], { ProductSourceID: "s-shopee" }, 150_000, true)).toBeUndefined();
    expect(savingVsViewedSource([{ ...shopee, effective_price: 0 }, lazada], { ProductSourceID: "s-shopee" }, 150_000, true)).toBeUndefined();
  });

  it("is unknown when the viewed source is not in the comparison or is not Shopee", () => {
    expect(savingVsViewedSource([other, lazada], { ProductSourceID: "s-shopee" }, 150_000, true)).toBeUndefined();
    expect(savingVsViewedSource([lazada], { ProductSourceID: "s-laz" }, 100_000, true)).toBeUndefined();
    expect(savingVsViewedSource(undefined, { ProductSourceID: "s-shopee" }, 150_000, true)).toBeUndefined();
  });

  it("is unknown when the best price is not lower than the viewed price", () => {
    expect(savingVsViewedSource([shopee], { ProductSourceID: "s-shopee" }, 200_000, true)).toBeUndefined();
  });

  describe("compares like with like (best_deal.shipping_included)", () => {
    // Viewed Shopee source: item 180k + shipping 20k = effective 200k
    const viewed = { ...shopee, listed_price: 180_000, shipping_fee: 20_000, effective_price: 200_000 };

    it("compares effective prices when the best deal includes shipping", () => {
      expect(savingVsViewedSource([viewed, lazada], { ProductSourceID: "s-shopee" }, 150_000, true)).toBe(25);
    });

    it("compares item prices when the best deal is an item price (shipping not included)", () => {
      // Best item price 162k vs the viewed item price 180k = 10% (not 19% against the 200k with shipping)
      expect(savingVsViewedSource([viewed, lazada], { ProductSourceID: "s-shopee" }, 162_000, false)).toBeCloseTo(10);
      // A best item price above the viewed item price is no saving, although it is below the 200k effective price
      expect(savingVsViewedSource([viewed, lazada], { ProductSourceID: "s-shopee" }, 190_000, false)).toBeUndefined();
    });

    it("derives the item price from effective_price minus a known shipping fee", () => {
      const noListed = { ...viewed, listed_price: null };
      expect(savingVsViewedSource([noListed, lazada], { ProductSourceID: "s-shopee" }, 162_000, false)).toBeCloseTo(10);
    });

    it("is unknown when the viewed item price cannot be known", () => {
      const unknownItem = { ...viewed, listed_price: null, shipping_fee: null };
      expect(savingVsViewedSource([unknownItem, lazada], { ProductSourceID: "s-shopee" }, 162_000, false)).toBeUndefined();
    });

    it("is unknown when the basis of the best price is not stated", () => {
      expect(savingVsViewedSource([viewed, lazada], { ProductSourceID: "s-shopee" }, 150_000, undefined)).toBeUndefined();
    });
  });
});
