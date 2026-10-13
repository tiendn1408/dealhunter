import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Runs public/caffiliate_bridge.js (main-world helper) against a fake Caffiliate page.
const w = window as any;
const fetchMock = vi.fn();
const getTokenMock = vi.fn(async () => "fresh-token");

/** Fires one strike and resolves with the run the helper reports when it finishes. */
function strike(): Promise<any> {
  return new Promise((resolve) => {
    const onRun = (ev: Event) => {
      window.removeEventListener("dh-checkin-timing", onRun);
      resolve(JSON.parse((ev as CustomEvent).detail));
    };
    window.addEventListener("dh-checkin-timing", onRun);
    window.dispatchEvent(new CustomEvent("dh-caffiliate-strike"));
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("caffiliate_bridge strike", () => {
  beforeAll(() => {
    w.fetch = fetchMock;
    w.CheckInTurnstile = { getToken: getTokenMock };
    const src = readFileSync(path.resolve(__dirname, "../../../public/caffiliate_bridge.js"), "utf8");
    new Function(src)();
  });

  beforeEach(() => {
    fetchMock.mockReset();
    getTokenMock.mockClear();
    document.body.innerHTML = `<button id="btnCheckIn" disabled>Điểm danh</button>`;
  });

  it("tier 1: runs app.checkIn() even though the page still shows yesterday's check-in", async () => {
    const checkIn = vi.fn(async function (this: any) {
      expect(this.state.todayCheckedIn).toBe(false);
      await sleep(10);
      this.state.todayCheckedIn = true;
    });
    w.app = { state: { todayCheckedIn: true, checkInLocked: true }, checkIn };
    document.body.innerHTML = `<button id="btnCheckIn" disabled>Đã điểm danh #3</button>`;

    const run = await strike();

    expect(run.ok).toBe(true);
    expect(checkIn).toHaveBeenCalledTimes(1); // confirmed before attempt 2 was due
    expect(run.attempts[0].tiers).toEqual([{ tier: 1, ok: true, name: "checkIn()" }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps sending attempts 35ms apart (max 4) until the server confirms", async () => {
    const state = { todayCheckedIn: false, isCheckingIn: false };
    const checkIn = vi.fn(async () => {
      state.isCheckingIn = true; // in-flight lock the next attempt has to clear
    });
    w.app = { state, checkIn };

    const pending = strike();
    await sleep(250);
    expect(checkIn).toHaveBeenCalledTimes(4);
    state.todayCheckedIn = true;
    const run = await pending;

    expect(run.ok).toBe(true);
    expect(run.attempts.map((a: any) => a.n)).toEqual([1, 2, 3, 4]);
    expect(run.attempts[1].startAt - run.attempts[0].startAt).toBeGreaterThanOrEqual(30);
  });

  it("tier 2: falls back to the API with a fresh token and the page's own signature", async () => {
    w.app = {
      state: { todayCheckedIn: false, csrfToken: "csrf" },
      checkIn: vi.fn(async () => {
        throw new Error("boom");
      }),
      generateSignature: vi.fn(async () => "sig"),
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));

    const run = await strike();

    expect(run.ok).toBe(true);
    expect(run.attempts[0].tiers).toEqual([
      { tier: 1, ok: false, error: "boom" },
      { tier: 2, ok: true, name: "API" },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v2/xeng/check-in-secure");
    expect(init.headers["x-signature"]).toBe("sig");
    expect(JSON.parse(init.body)["cf-turnstile-response"]).toBe("fresh-token");
    expect(run.attempts[0].tokenStartAt).toBeTypeOf("number");
    expect(run.attempts[0].requestStartAt).toBeTypeOf("number");
  });

  it("tier 3: clicks the button when function and API both fail; no API call without a signature", async () => {
    w.app = { state: { todayCheckedIn: false }, checkIn: () => { throw new Error("boom"); } };
    const btn = document.getElementById("btnCheckIn") as HTMLButtonElement;
    btn.addEventListener("click", () => {
      btn.textContent = "Đã điểm danh #6";
    });

    const run = await strike();

    expect(run.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(run.attempts[0].tiers.map((t: any) => [t.tier, t.ok])).toEqual([
      [1, false],
      [2, false],
      [3, true],
    ]);
    expect(run.attempts[0].tiers[1].error).toContain("signature");
  });

  it("uses a reward-named method when the page has no checkIn()", async () => {
    const state = { todayCheckedIn: false };
    const claimDailyReward = vi.fn(async () => {
      state.todayCheckedIn = true;
    });
    w.app = { state, claimDailyReward };

    const run = await strike();

    expect(run.ok).toBe(true);
    expect(claimDailyReward).toHaveBeenCalledTimes(1);
    expect(run.attempts[0].tiers[0].name).toBe("claimDailyReward()");
  });
});
