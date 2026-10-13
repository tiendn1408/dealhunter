import { describe, it, expect } from "vitest";
import { normalizePageUrl, isSamePageUrl, isValidHttpUrl } from "./url";

describe("Batch 1.3: URL Normalization & Matching (H7)", () => {
  it("preserves functional query parameters and distinguishes different items/events", () => {
    const url1 = "https://shopee.vn/event?id=1";
    const url2 = "https://shopee.vn/event?id=2";
    expect(isSamePageUrl(url1, url2)).toBe(false);
  });

  it("strips marketing tracking parameters (utm_*, fbclid, etc.) while keeping target parameters", () => {
    const base = "https://shopee.vn/event?id=1";
    const tracked = "https://shopee.vn/event?id=1&utm_source=facebook&utm_campaign=flash&fbclid=123456";
    expect(isSamePageUrl(base, tracked)).toBe(true);
  });

  it("preserves SPA hash routes", () => {
    const hash1 = "https://shopee.vn/portal#/vouchers";
    const hash2 = "https://shopee.vn/portal#/products";
    expect(isSamePageUrl(hash1, hash2)).toBe(false);

    const hashSame = "https://shopee.vn/portal?utm_medium=cpc#/vouchers";
    expect(isSamePageUrl(hash1, hashSame)).toBe(true);
  });

  it("normalizes query parameter order", () => {
    const u1 = "https://example.com/page?b=2&a=1";
    const u2 = "https://example.com/page?a=1&b=2";
    expect(isSamePageUrl(u1, u2)).toBe(true);
  });
});

describe("L2: URL scheme validation (isValidHttpUrl)", () => {
  it("accepts valid http and https URLs", () => {
    expect(isValidHttpUrl("https://shopee.vn/flash-sale")).toBe(true);
    expect(isValidHttpUrl("http://localhost:3000/deal")).toBe(true);
    expect(isValidHttpUrl("https://app.caffiliate.vn/mission?id=1#tab")).toBe(true);
  });

  it("rejects non-http schemes (javascript:, file:, chrome:, data:, blob:, about:)", () => {
    expect(isValidHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isValidHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isValidHttpUrl("chrome://extensions")).toBe(false);
    expect(isValidHttpUrl("chrome-extension://abcdef/popup.html")).toBe(false);
    expect(isValidHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isValidHttpUrl("about:blank")).toBe(false);
    expect(isValidHttpUrl("blob:https://shopee.vn/123")).toBe(false);
    expect(isValidHttpUrl("ftp://ftp.example.com")).toBe(false);
  });

  it("rejects invalid or empty inputs", () => {
    expect(isValidHttpUrl("")).toBe(false);
    expect(isValidHttpUrl("   ")).toBe(false);
    expect(isValidHttpUrl("not-a-url")).toBe(false);
    expect(isValidHttpUrl(null as any)).toBe(false);
    expect(isValidHttpUrl(undefined as any)).toBe(false);
  });
});

describe("isSiteHost", () => {
  it("matches the site and its subdomains on its country domains only", async () => {
    const { isSiteHost } = await import("./url");
    expect(isSiteHost("https://shopee.vn/m/x", "shopee.")).toBe(true);
    expect(isSiteHost("https://shopee.co.id/", "shopee.")).toBe(true);
    expect(isSiteHost("https://www.lazada.com.my/", "lazada.")).toBe(true);
    expect(isSiteHost("https://shopee.evil.com/", "shopee.")).toBe(false);
    expect(isSiteHost("https://example.com/?ref=shopee.vn", "shopee.")).toBe(false);
    expect(isSiteHost("https://tiki.vn/a", "tiki.vn")).toBe(true);
    expect(isSiteHost("https://nottiki.vn/a", "tiki.vn")).toBe(false);
    expect(isSiteHost("https://shop.tiktok.com/x", "tiktok.com")).toBe(true);
  });
});
