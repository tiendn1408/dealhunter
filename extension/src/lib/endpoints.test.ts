import { describe, it, expect } from "vitest";
import { resolveEndpoints, validateApiUrl, validateWebUrl } from "./endpoints";
import { DEFAULT_SETTINGS } from "./constants";

describe("validateApiUrl", () => {
  it.each([
    ["https://api.dealhunter.io.vn/api/v1", "https://api.dealhunter.io.vn/api/v1"],
    ["https://api.dealhunter.io.vn/api/v1/", "https://api.dealhunter.io.vn/api/v1"],
    ["https://dealhunter.io.vn/api/v1", "https://dealhunter.io.vn/api/v1"],
    ["http://localhost:8080/api/v1", "http://localhost:8080/api/v1"],
    ["http://127.0.0.1:8080/api/v1", "http://127.0.0.1:8080/api/v1"],
  ])("accepts %s", (input, want) => {
    expect(validateApiUrl(input)).toBe(want);
  });

  it.each([
    ["http://api.dealhunter.io.vn/api/v1"], // production host without TLS
    ["https://evil.example/api/v1"],
    ["https://dealhunter.io.vn.evil.example/api/v1"],
    ["https://evildealhunter.io.vn/api/v1"],
    ["javascript:alert(1)"],
    ["ftp://api.dealhunter.io.vn/api/v1"],
    ["https://user:pw@api.dealhunter.io.vn/api/v1"],
    ["https://api.dealhunter.io.vn/api/v1?x=1"],
    ["/api/v1"],
    [""],
    [null],
    [42],
  ])("rejects %s", (input) => {
    expect(validateApiUrl(input)).toBeNull();
  });
});

describe("validateWebUrl", () => {
  it("accepts a DealHunter web origin matching the sender", () => {
    expect(validateWebUrl("https://dealhunter.io.vn", "https://dealhunter.io.vn")).toBe("https://dealhunter.io.vn");
    expect(validateWebUrl("https://www.dealhunter.io.vn", "https://www.dealhunter.io.vn")).toBe("https://www.dealhunter.io.vn");
    expect(validateWebUrl("http://localhost:3100", "http://localhost:3100")).toBe("http://localhost:3100");
  });

  it("rejects origins that are not DealHunter web or not the sender", () => {
    expect(validateWebUrl("https://evil.example", "https://evil.example")).toBeNull();
    expect(validateWebUrl("https://dealhunter.io.vn", "http://localhost:3000")).toBeNull();
    expect(validateWebUrl("javascript:alert(1)")).toBeNull();
    expect(validateWebUrl(undefined)).toBeNull();
  });
});

describe("resolveEndpoints", () => {
  it("falls back to the dev defaults for missing or invalid stored values", () => {
    expect(resolveEndpoints({})).toEqual({
      apiUrl: DEFAULT_SETTINGS.dealHunterApiUrl,
      webUrl: DEFAULT_SETTINGS.dealHunterWebUrl,
    });
    expect(resolveEndpoints({ dealHunterApiUrl: "https://evil.example/api", dealHunterWebUrl: "https://evil.example" })).toEqual({
      apiUrl: DEFAULT_SETTINGS.dealHunterApiUrl,
      webUrl: DEFAULT_SETTINGS.dealHunterWebUrl,
    });
  });

  it("uses valid stored production values", () => {
    expect(
      resolveEndpoints({ dealHunterApiUrl: "https://api.dealhunter.io.vn/api/v1", dealHunterWebUrl: "https://dealhunter.io.vn" })
    ).toEqual({ apiUrl: "https://api.dealhunter.io.vn/api/v1", webUrl: "https://dealhunter.io.vn" });
  });
});
