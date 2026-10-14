import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Runs public/caffiliate_bridge.js (main-world helper) against a fake Caffiliate page.
const w = window as any;
const fetchMock = vi.fn();
const getTokenMock = vi.fn(async () => "fresh-token");

/** Fires one strike and resolves with the run the helper reports when it finishes. */
function strike(offsetsMs?: number[]): Promise<any> {
  return new Promise((resolve) => {
    const onRun = (ev: Event) => {
      window.removeEventListener("dh-checkin-timing", onRun);
      resolve(JSON.parse((ev as CustomEvent).detail));
    };
    window.addEventListener("dh-checkin-timing", onRun);
    const detail = offsetsMs ? JSON.stringify({ offsetsMs, plan: { attempts: offsetsMs.length } }) : undefined;
    window.dispatchEvent(new CustomEvent("dh-caffiliate-strike", { detail }));
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

  it("starts the attempts on the planned schedule until the server confirms", async () => {
    const state = { todayCheckedIn: false, isCheckingIn: false };
    const checkIn = vi.fn(async () => {
      state.isCheckingIn = true; // in-flight lock the next attempt has to clear
    });
    w.app = { state, checkIn };

    const pending = strike([0, 20, 45, 70, 100, 130]);
    await sleep(220);
    expect(checkIn).toHaveBeenCalledTimes(6);
    state.todayCheckedIn = true;
    const run = await pending;

    expect(run.ok).toBe(true);
    expect(run.plan).toEqual({ attempts: 6 });
    const starts = run.attempts.map((a: any) => a.startAt - run.startAt);
    expect(starts[0]).toBeLessThan(5);
    expect(starts[2]).toBeGreaterThanOrEqual(44.7);
    expect(starts[5]).toBeGreaterThanOrEqual(129.7);
  });

  it("cancels the remaining attempts as soon as one is confirmed", async () => {
    const state = { todayCheckedIn: false };
    const checkIn = vi.fn(async () => {
      await sleep(15);
      state.todayCheckedIn = true;
    });
    w.app = { state, checkIn };

    const run = await strike([0, 40, 80, 120, 160]);
    await sleep(200); // past every planned start

    expect(run.ok).toBe(true);
    expect(checkIn).toHaveBeenCalledTimes(1);
    expect(run.attempts).toHaveLength(1);
  });

  it("without a schedule it still sends 5 attempts", async () => {
    const state = { todayCheckedIn: false };
    const checkIn = vi.fn(async () => {});
    w.app = { state, checkIn };

    const pending = strike();
    await sleep(200);
    state.todayCheckedIn = true;
    const run = await pending;

    expect(run.attempts).toHaveLength(5);
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

  it("finds a check-in method declared on the page's class (prototype)", async () => {
    class RewardApp {
      state = { todayCheckedIn: false };
      diemDanh() {
        this.state.todayCheckedIn = true;
      }
    }
    const inst = new RewardApp();
    const spy = vi.spyOn(RewardApp.prototype, "diemDanh");
    w.app = inst;

    const run = await strike();

    expect(run.ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(run.attempts[0].tiers[0].name).toBe("diemDanh()");
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

  it("logs only the check-in POST as an attempt's request, not the page's status GETs after it", async () => {
    const realFetch = w.fetch;
    const calls: string[] = [];
    // the bridge wraps window.fetch at load: route the mock through a fresh copy of the wrapper
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return new Response("{}", { status: 200 });
    });
    const state = { todayCheckedIn: false };
    const checkIn = vi.fn(async () => {
      await w.fetch("/api/v2/xeng/check-in-status"); // a GET with "check-in" in the URL
      await sleep(40);
      await w.fetch("/api/v2/xeng/check-in-secure", { method: "POST", body: "{}" });
      state.todayCheckedIn = true;
    });
    w.app = { state, checkIn };

    const run = await strike([0]);
    expect(calls).toEqual(["GET /api/v2/xeng/check-in-status", "POST /api/v2/xeng/check-in-secure"]);
    const a = run.attempts[0];
    // the request time is the POST's (40 ms after the status GET), not the GET's
    expect(a.requestStartAt - a.startAt).toBeGreaterThanOrEqual(35);
    w.fetch = realFetch;
  });

  it("logs what the server answered: message-like fields only, never the whole body", async () => {
    const answers = [
      new Response(JSON.stringify({ success: false, message: "Chưa tới giờ điểm danh", token: "secret-token" }), { status: 409 }),
      new Response(JSON.stringify({ success: true, data: { message: "Điểm danh thành công", rank: 4, csrf: "secret-csrf" } }), { status: 200 }),
    ];
    fetchMock.mockImplementation(async () => answers.shift());
    const state = { todayCheckedIn: false };
    const checkIn = vi.fn(async () => {
      const r = await w.fetch("/api/v2/xeng/check-in-secure", { method: "POST", body: "{}" });
      if (r.ok) state.todayCheckedIn = true;
    });
    w.app = { state, checkIn };

    const run = await strike([0, 30]);
    const replies = run.attempts.map((a: any) => a.reply);
    expect(replies[0]).toBe("success=false · Chưa tới giờ điểm danh");
    expect(replies[1]).toBe("success=true · Điểm danh thành công · rank=4");
    expect(JSON.stringify(run)).not.toContain("secret");
    expect(run.attempts.some((a: any) => "replyPending" in a)).toBe(false);
  });

  it("an HTML error page is logged as its short text", async () => {
    fetchMock.mockImplementation(async () =>
      new Response("<html><head><style>b{}</style></head><body><h1>502 Bad Gateway</h1></body></html>", { status: 502 })
    );
    const state = { todayCheckedIn: false };
    const checkIn = vi.fn(async () => {
      await w.fetch("/api/v2/xeng/check-in-secure", { method: "POST", body: "{}" });
      state.todayCheckedIn = true; // end the run without waiting for the 8 s timeout
    });
    w.app = { state, checkIn };

    const run = await strike([0]);
    expect(run.attempts[0].status).toBe(502);
    expect(run.attempts[0].reply).toBe("502 Bad Gateway");
  });
});
