import { describe, it, expect, beforeEach, vi } from "vitest";
import { webSession } from "./web_session";
import { shopeeIds, apiClient } from "../lib/api_client";
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
  apiUrl: "http://localhost:8080/api/v1",
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

  it("does not use a stored session without an API URL of its own (older record)", async () => {
    store[STORAGE_KEYS.WEB_SESSION] = { accessToken: "old", expiresAt: Date.now() + 60_000 };
    expect(await webSession.get()).toBeNull();
  });

  it("does not return a stored session after it expires", async () => {
    store[STORAGE_KEYS.WEB_SESSION] = { accessToken: "old", expiresAt: Date.now() - 1 };
    expect(await webSession.get()).toBeNull();
  });
});

describe("web app URLs in the session message", () => {
  const PROD = "https://dealhunter.vn";

  it("stores valid API and web URLs sent by the DealHunter web app, with the token", async () => {
    await webSession.handleExternalMessage(msg({ apiUrl: "https://api.dealhunter.vn/api/v1/", webUrl: PROD }), PROD);
    const session = await webSession.get();
    expect(session?.apiUrl).toBe("https://api.dealhunter.vn/api/v1");
    expect(session?.webUrl).toBe(PROD);
    expect((await storage.getEndpoints()).webUrl).toBe(PROD);
  });

  it("keeps the URLs on sign-out (no token)", async () => {
    await webSession.handleExternalMessage(msg({ apiUrl: "https://api.dealhunter.vn/api/v1", webUrl: PROD }), PROD);
    await webSession.handleExternalMessage(msg({ accessToken: null, apiUrl: "https://api.dealhunter.vn/api/v1", webUrl: PROD }), PROD);
    expect(await webSession.get()).toBeNull();
    expect((await storage.getEndpoints()).webUrl).toBe(PROD);
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
    expect(local[STORAGE_KEYS.LAST_WEB_URL]).toBeUndefined();
    expect(store[STORAGE_KEYS.WEB_SESSION]).toBeUndefined();
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

describe("concurrent pushes from two allowed pages (dev and production)", () => {
  const PROD = "https://dealhunter.vn";
  const PROD_API = "https://api.dealhunter.vn/api/v1";
  const DEV_API = "http://localhost:8080/api/v1";
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // Storage writes take a variable time (here: by content), so concurrent handlers' writes land in any
  // order, as they can in a real service worker: the production token's session write is slow, the dev
  // page's settings write is slow.
  const latency = (items: Record<string, unknown>) => {
    const json = JSON.stringify(items);
    if (json.includes("prod-token")) return 40;
    return json.includes("localhost") && !json.includes("token") ? 20 : 1;
  };
  beforeEach(() => {
    vi.stubGlobal("chrome", {
      storage: {
        session: {
          get: async (key: string) => (await sleep(1), { [key]: store[key] }),
          set: async (items: Record<string, unknown>) => (await sleep(latency(items)), void Object.assign(store, items)),
          remove: async (key: string) => (await sleep(1), void delete store[key]),
        },
        local: {
          get: async (key: string) => (await sleep(1), { [key]: local[key] }),
          set: async (items: Record<string, unknown>) => (await sleep(latency(items)), void Object.assign(local, items)),
        },
      },
    });
  });

  const pairs = { "prod-token": PROD_API, "dev-token": DEV_API } as Record<string, string>;

  it.each([
    ["prod first", true],
    ["dev first", false],
  ])("a token is only ever paired with the API URL it arrived with (%s)", async (_, prodFirst) => {
    const prod = webSession.handleExternalMessage(msg({ accessToken: "prod-token", apiUrl: PROD_API, webUrl: PROD }), PROD);
    const dev = webSession.handleExternalMessage(msg({ accessToken: "dev-token", apiUrl: DEV_API, webUrl: WEB }), WEB);
    await (prodFirst ? Promise.all([prod, dev]) : Promise.all([dev, prod]));
    const session = await webSession.get();
    expect(session).not.toBeNull();
    expect(session!.apiUrl).toBe(pairs[session!.accessToken]);
    // ...and the API client sends it there
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await apiClient.getProductPriceContext("https://shopee.vn/x-i.1.2", session!);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.startsWith(pairs[session!.accessToken])).toBe(true);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${session!.accessToken}`);
  });

  it("never sends a production token over http to a local API", async () => {
    await Promise.all([
      webSession.handleExternalMessage(msg({ accessToken: "dev-token", apiUrl: DEV_API, webUrl: WEB }), WEB),
      webSession.handleExternalMessage(msg({ accessToken: "prod-token", apiUrl: PROD_API, webUrl: PROD }), PROD),
    ]);
    const session = (await webSession.get())!;
    if (session.accessToken === "prod-token") expect(session.apiUrl).toBe(PROD_API);
    expect(session.apiUrl?.startsWith("http://") && session.accessToken === "prod-token").toBe(false);
  });

  it("does not store a token without a valid API URL to use it with", async () => {
    await webSession.handleExternalMessage(msg({ accessToken: "prod-token", apiUrl: "https://evil.example/api/v1", webUrl: PROD }), PROD);
    expect(await webSession.get()).toBeNull();
  });

  it("a concurrent language change does not overwrite the web URL (and vice versa)", async () => {
    await Promise.all([
      webSession.handleExternalMessage(msg({ apiUrl: PROD_API, webUrl: PROD }), PROD),
      storage.setLanguage("vi"),
    ]);
    expect((await storage.getEndpoints()).webUrl).toBe(PROD);
    expect(await storage.getLanguage()).toBe("vi");
  });

  it("keeps the last web URL for links after sign-out", async () => {
    await webSession.handleExternalMessage(msg({ accessToken: "prod-token", apiUrl: PROD_API, webUrl: PROD }), PROD);
    await webSession.handleExternalMessage(msg({ accessToken: null, apiUrl: PROD_API, webUrl: PROD }), PROD);
    expect(await webSession.get()).toBeNull();
    expect((await storage.getEndpoints()).webUrl).toBe(PROD);
  });
});
