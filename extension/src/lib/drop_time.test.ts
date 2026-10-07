import { describe, it, expect } from "vitest";
import { nextDropAt, nextFlashDrop, formatVN } from "./drop_time";

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
  it("formats Vietnam wall clock", () => {
    expect(formatVN(vn("2026-10-07T20:59:59.900"))).toBe("20:59:59.900");
  });
});
