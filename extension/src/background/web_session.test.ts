import { describe, it, expect, beforeEach, vi } from "vitest";
import { webSession } from "./web_session";
import { shopeeIds } from "../lib/api_client";
import { DEFAULT_SETTINGS, STORAGE_KEYS, WEB_SESSION_MESSAGE } from "../lib/constants";
import { storage } from "../lib/storage";

// In-memory stand-in for chrome.storage.session
let store: Record<string, unknown>;
let local: Record<string, unknown>;
beforeEach(() => {
  store = {};
  local = {};
  vi.stubGlobal("chrome", {
    storage: {
      session: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (items: Record<string, unknown>) => Object.assign(store, items),
        remove: async (key: string) => void delete store[key],
      },
      local: {
        get: async (key: string) => ({ [key]: local[key] }),
        set: async (items: Record<string, unknown>) => Object.assign(local, items),
      },
    },
  });
});

const WEB = "http://localhost:3000";
const msg = (extra: Record<string, unknown> = {}) => ({
  type: WEB_SESSION_MESSAGE,
  accessToken: "token-1",
  expiresAt: Date.now() + 60_000,
  email: "a@example.com",
  ...extra,
});

describe("webSession.handleExternalMessage", () => {
  it("stores a session sent by the DealHunter web app", async () => {
    expect(await webSession.handleExternalMessage(msg(), WEB)).toBe(true);
    expect((await webSession.get())?.accessToken).toBe("token-1");
  });

  it("ignores pages that are not DealHunter web", async () => {
    expect(await webSession.handleExternalMessage(msg(), "https://evil.example")).toBe(false);
    expect(await webSession.handleExternalMessage(msg(), undefined)).toBe(false);
    expect(store[STORAGE_KEYS.WEB_SESSION]).toBeUndefined();
  });

  it("clears the session on sign-out (no token) and on an expired token", async () => {
    await webSession.handleExternalMessage(msg(), WEB);
    await webSession.handleExternalMessage(msg({ accessToken: null }), WEB);
    expect(await webSession.get()).toBeNull();

    await webSession.handleExternalMessage(msg(), WEB);
    await webSession.handleExternalMessage(msg({ expiresAt: Date.now() - 1 }), WEB);
    expect(await webSession.get()).toBeNull();
  });

  it("does not return a stored session after it expires", async () => {
    store[STORAGE_KEYS.WEB_SESSION] = { accessToken: "old", expiresAt: Date.now() - 1 };
    expect(await webSession.get()).toBeNull();
  });
});

describe("web app URLs in the session message", () => {
  const PROD = "https://dealhunter.vn";

  it("stores valid API and web URLs sent by the DealHunter web app", async () => {
    await webSession.handleExternalMessage(msg({ apiUrl: "https://api.dealhunter.vn/api/v1/", webUrl: PROD }), PROD);
    expect(await storage.getEndpoints()).toEqual({ apiUrl: "https://api.dealhunter.vn/api/v1", webUrl: PROD });
  });

  it("keeps the URLs on sign-out (no token)", async () => {
    await webSession.handleExternalMessage(msg({ apiUrl: "https://api.dealhunter.vn/api/v1", webUrl: PROD }), PROD);
    await webSession.handleExternalMessage(msg({ accessToken: null, apiUrl: "https://api.dealhunter.vn/api/v1", webUrl: PROD }), PROD);
    expect(await webSession.get()).toBeNull();
    expect((await storage.getEndpoints()).apiUrl).toBe("https://api.dealhunter.vn/api/v1");
  });

  it("ignores invalid URLs and keeps the dev defaults", async () => {
    await webSession.handleExternalMessage(msg({ apiUrl: "https://evil.example/api/v1", webUrl: "https://evil.example" }), PROD);
    expect(await storage.getEndpoints()).toEqual({
      apiUrl: DEFAULT_SETTINGS.dealHunterApiUrl,
      webUrl: DEFAULT_SETTINGS.dealHunterWebUrl,
    });
  });

  it("does not accept a web URL other than the sender's origin", async () => {
    await webSession.handleExternalMessage(msg({ webUrl: PROD }), WEB);
    expect((await storage.getEndpoints()).webUrl).toBe(DEFAULT_SETTINGS.dealHunterWebUrl);
  });

  it("stores nothing for pages that are not DealHunter web", async () => {
    await webSession.handleExternalMessage(msg({ apiUrl: "https://api.dealhunter.vn/api/v1" }), "https://evil.example");
    expect(local[STORAGE_KEYS.SETTINGS]).toBeUndefined();
  });
});

describe("shopeeIds", () => {
  it.each([
    ["https://shopee.vn/Tai-nghe-Sony-i.111.222", { shopId: "111", itemId: "222" }],
    ["https://shopee.vn/product/111/222?sp_atk=x", { shopId: "111", itemId: "222" }],
    ["https://shopee.vn/m/ma-giam-gia", null],
  ])("%s", (url, want) => {
    expect(shopeeIds(url)).toEqual(want);
  });
});
