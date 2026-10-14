import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { productionManifest } from "../build/manifest_env";

// What a production build (`npm run build`) trusts: only DealHunter's real origins.
vi.mock("./build_env", () => ({ IS_DEV_BUILD: false }));

const { DEALHUNTER_WEB_ORIGINS, DEFAULT_SETTINGS } = await import("./constants");
const { validateApiUrl, validateWebUrl, resolveEndpoints } = await import("./endpoints");
const { getAdapterForUrl } = await import("../content/adapters");

describe("production build", () => {
  it("accepts a sign-in session only from dealhunter.io.vn", () => {
    expect(DEALHUNTER_WEB_ORIGINS).toEqual(["https://dealhunter.io.vn", "https://www.dealhunter.io.vn"]);
    expect(validateWebUrl("http://localhost:3000")).toBeNull();
    expect(validateWebUrl("https://www.dealhunter.io.vn")).toBe("https://www.dealhunter.io.vn");
  });

  it("never sends the token to a local API server", () => {
    expect(validateApiUrl("http://localhost:8080/api/v1")).toBeNull();
    expect(validateApiUrl("http://127.0.0.1:9999/api/v1")).toBeNull();
    expect(validateApiUrl("https://dealhunter.io.vn/api/v1")).toBe("https://dealhunter.io.vn/api/v1");
  });

  it("defaults to the real DealHunter web and API", () => {
    expect(DEFAULT_SETTINGS.dealHunterApiUrl).toBe("https://dealhunter.io.vn/api/v1");
    expect(DEFAULT_SETTINGS.dealHunterWebUrl).toBe("https://dealhunter.io.vn");
    expect(resolveEndpoints({ dealHunterApiUrl: "http://localhost:8080/api/v1" }).apiUrl).toBe(
      "https://dealhunter.io.vn/api/v1"
    );
  });

  it("does not treat a local page as the Caffiliate simulator", () => {
    expect(getAdapterForUrl("http://localhost:3100/")).toBeNull();
    expect(getAdapterForUrl("https://app.caffiliate.vn/rewards")?.platformName).toBe("caffiliate");
  });

  it("ships a manifest without localhost entries", () => {
    const manifest = JSON.parse(readFileSync(path.resolve(__dirname, "../../public/manifest.json"), "utf8"));
    const prod = productionManifest(manifest);
    const all = JSON.stringify(prod);
    expect(all).not.toMatch(/localhost|127\.0\.0\.1/);
    expect(prod.externally_connectable.matches).toEqual(["https://dealhunter.io.vn/*", "https://www.dealhunter.io.vn/*"]);
    const bridge = prod.content_scripts.find((cs: any) => cs.js.includes("caffiliate_bridge.js"));
    expect(bridge.matches).toEqual(["https://caffiliate.vn/*", "https://*.caffiliate.vn/*"]);
    // the source manifest (development) is left untouched
    expect(JSON.stringify(manifest)).toMatch(/localhost:3100/);
  });
});
