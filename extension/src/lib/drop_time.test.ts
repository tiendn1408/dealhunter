import { describe, it, expect } from "vitest";
import { nextDropAt, nextFlashDrop, formatVN, nextExactDropAt, formatCountdown } from "./drop_time";

const vn = (iso: string) => new Date(iso + "+07:00").getTime();

describe("drop time (Vietnam GMT+7)", () => {
  it("21:00 today when it is 18:20 in Vietnam", () => {
    expect(nextDropAt(21, 0, vn("2026-10-07T18:20:00"))).toBe(vn("2026-10-07T21:00:00"));
  });
  it("00:00 is tomorrow midnight", () => {
    expect(nextDropAt(0, 0, vn("2026-10-07T21:05:00"))).toBe(vn("2026-10-08T00:00:00"));
  });
  it("a drop that just started (within grace) is still the current one", () => {
    expect(nextDropAt(21, 0, vn("2026-10-07T21:00:02"))).toBe(vn("2026-10-07T21:00:00"));
  });
  it("next flash slot after 21:00 is midnight", () => {
    expect(nextFlashDrop([0, 9, 12, 15, 18, 21], vn("2026-10-07T21:00:30"))).toEqual({ at: vn("2026-10-08T00:00:00"), hour: 0 });
  });
  it("formats Vietnam wall clock with standard 2 digits per unit", () => {
    expect(formatVN(vn("2026-10-07T20:59:59.900"))).toBe("20:59:59.90");
    expect(formatVN(vn("2026-10-07T20:59:59.900"), 3)).toBe("20:59:59.900");
  });
  it("calculates next exact second in Vietnam time", () => {
    expect(nextExactDropAt(18, 30, 45, vn("2026-10-07T18:20:00"))).toBe(vn("2026-10-07T18:30:45"));
    expect(nextExactDropAt(18, 20, 0, vn("2026-10-07T18:20:01"))).toBe(vn("2026-10-08T18:20:00"));
  });
  it("formats countdown in consistent HH:mm:ss.SS format", () => {
    // 26m 27.5s -> 00:26:27.50
    const ms26m = 26 * 60_000 + 27 * 1_000 + 500;
    expect(formatCountdown(ms26m)).toBe("00:26:27.50");

    // 0ms -> 00:00:00.00
    expect(formatCountdown(0)).toBe("00:00:00.00");
    expect(formatCountdown(-500)).toBe("00:00:00.00");

    // 1h 2m 3.4s -> 01:02:03.40
    const ms1h = 1 * 3_600_000 + 2 * 60_000 + 3 * 1_000 + 400;
    expect(formatCountdown(ms1h)).toBe("01:02:03.40");

    // 12h 45m 30.9s -> 12:45:30.90
    const ms12h = 12 * 3_600_000 + 45 * 60_000 + 30 * 1_000 + 900;
    expect(formatCountdown(ms12h)).toBe("12:45:30.90");
  });
});
