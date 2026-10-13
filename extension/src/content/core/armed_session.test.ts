import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HuntCoordinator, ARMED_SESSION_KEY } from "./hunt_coordinator";
import { timeSyncClient } from "./time_sync_client";

// The page can read and write its own sessionStorage. A hunt resumed after a reload must come from
// what the extension stored, never from what the page wrote there (e.g. a forged session pointing at
// "Mua ngay").

let local: Record<string, unknown>;

beforeEach(() => {
  sessionStorage.clear();
  local = {};
  document.body.innerHTML = `<button id="save">Lưu</button><button id="buy">Mua ngay</button>`;
  vi.spyOn(timeSyncClient, "getServerTime").mockReturnValue(1_000_000);
  vi.stubGlobal("chrome", {
    runtime: { sendMessage: vi.fn().mockResolvedValue({}) },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: structuredClone(local[key]) }),
        set: async (items: Record<string, unknown>) => Object.assign(local, structuredClone(items)),
      },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("armed session across a reload", () => {
  it("a session the page wrote itself is not resumed", async () => {
    const buy = document.getElementById("buy")!;
    const forged = new HuntCoordinator();
    // what a page script could write
    sessionStorage.setItem(
      ARMED_SESSION_KEY,
      JSON.stringify({
        targetTimestamp: 1_010_000,
        url: window.location.href,
        armedAt: 999_000,
        token: "guessed",
        descriptor: { id: "buy", tagName: "button", attributes: {}, initialText: buy.textContent },
      })
    );
    expect(await forged.checkAndResumeArmedSession()).toBe(false);
    expect(forged.isArmed()).toBe(false);
    expect(sessionStorage.getItem(ARMED_SESSION_KEY)).toBeNull();
  });

  it("the extension's own session is resumed, even if the page edits the copy in sessionStorage", async () => {
    const save = document.getElementById("save")!;
    new HuntCoordinator().arm({ targetTimestamp: 1_010_000, targetElement: save, label: "Lưu" });
    await flush();

    // page swaps the target in its copy
    const copy = JSON.parse(sessionStorage.getItem(ARMED_SESSION_KEY)!);
    copy.descriptor.id = "buy";
    copy.descriptor.initialText = "Mua ngay";
    copy.targetTimestamp = 1_005_000;
    sessionStorage.setItem(ARMED_SESSION_KEY, JSON.stringify(copy));

    // reload: a fresh content script
    const resumed = new HuntCoordinator();
    expect(await resumed.checkAndResumeArmedSession()).toBe(true);
    const session = resumed.getCurrentSession()!;
    expect(session.descriptor?.id).toBe("save");
    expect(session.targetTimestamp).toBe(1_010_000);
    resumed.disarm(false);
  });
});
