import { describe, it, expect, beforeEach, vi } from "vitest";
import { webSession } from "./web_session";
import { shopeeIds } from "../lib/api_client";
import { STORAGE_KEYS, WEB_SESSION_MESSAGE } from "../lib/constants";

// In-memory stand-in for chrome.storage.session
let store: Record<string, unknown>;
beforeEach(() => {
  store = {};
  vi.stubGlobal("chrome", {
    storage: {
      session: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (items: Record<string, unknown>) => Object.assign(store, items),
        remove: async (key: string) => void delete store[key],
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

describe("shopeeIds", () => {
  it.each([
    ["https://shopee.vn/Tai-nghe-Sony-i.111.222", { shopId: "111", itemId: "222" }],
    ["https://shopee.vn/product/111/222?sp_atk=x", { shopId: "111", itemId: "222" }],
    ["https://shopee.vn/m/ma-giam-gia", null],
  ])("%s", (url, want) => {
    expect(shopeeIds(url)).toEqual(want);
  });
});
