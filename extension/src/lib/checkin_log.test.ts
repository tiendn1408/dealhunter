import { describe, it, expect } from "vitest";
import { CheckInLogEntry, prepSamplesFromLogs, serverSamplesFromLogs, toCheckInLogEntry, describeAttempt } from "./checkin_log";

const attempt = (n: number, sentAfterMs: number | null, serverMs: number | null, tier: 1 | 2 | 3 = 1) => ({
  n,
  start: "23:59:59.906",
  tiers: [{ tier, ok: true }],
  tokenMs: null,
  tokenError: false,
  sent: sentAfterMs === null ? null : "00:00:01.477",
  sentAfterMs,
  serverMs,
  status: serverMs === null ? null : 200,
});

const log = (attempts: ReturnType<typeof attempt>[], source: "strike" | "manual" = "strike"): CheckInLogEntry => ({
  at: 0,
  host: "caffiliate.vn",
  source,
  ok: true,
  method: "page confirmed",
  error: null,
  plan: null,
  attempts,
});

describe("timings learned from the check-in log", () => {
  it("uses only the attempt that went out first in each run (later ones wait behind its token)", () => {
    // 13/10: attempt 1 sent after 1571 ms; attempts 2 and 3 only went out after attempt 1's answer
    const night = log([attempt(1, 1571, 186), attempt(2, 1735, 181), attempt(3, 1699, 162), attempt(4, null, null)]);
    expect(prepSamplesFromLogs([night])).toEqual([1571]);
    expect(serverSamplesFromLogs([night])).toEqual([186]);
  });

  it("skips runs whose first tier failed, keeps manual clicks", () => {
    const failedFirst = log([{ ...attempt(1, 2500, 300), tiers: [{ tier: 1 as const, ok: false }] }]);
    const manual = log([attempt(1, 1400, 170, 3)], "manual");
    expect(prepSamplesFromLogs([failedFirst, manual])).toEqual([1400]);
  });

  it("keeps the server's answer in the stored log and the console line", () => {
    const entry = toCheckInLogEntry(
      {
        startAt: 1000,
        source: "strike",
        attempts: [{ n: 1, startAt: 1000, tiers: [{ tier: 1, ok: true }], requestStartAt: 2500, responseAt: 2690, status: 409, reply: "success=false · Chưa tới giờ" }],
      },
      0,
      "caffiliate.vn"
    );
    expect(entry.attempts[0].reply).toBe("success=false · Chưa tới giờ");
    expect(describeAttempt(entry.attempts[0])).toContain('"success=false · Chưa tới giờ"');
  });

  it("learns only from the site being hunted (simulator runs do not move the real site's plan)", () => {
    const real = log([attempt(1, 1571, 186)]);
    const sim = { ...log([attempt(1, 40, 5)]), host: "localhost" };
    expect(prepSamplesFromLogs([sim, real], 10, "caffiliate.vn")).toEqual([1571]);
    expect(serverSamplesFromLogs([sim, real], 10, "caffiliate.vn")).toEqual([186]);
  });
});
