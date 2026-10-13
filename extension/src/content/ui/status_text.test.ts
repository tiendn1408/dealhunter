import { describe, it, expect } from "vitest";
import { translateEngineStatus, platformBlockMessage } from "./status_text";
import { getTranslation } from "../../lib/i18n";
import { detectPlatformBlock } from "../platform_block";

const vi = getTranslation("vi");

describe("engine statuses in the user's language", () => {
  it.each([
    ["Disarmed", vi.disarmedStatus],
    ["Armed · Lưu", "Đã đặt mục tiêu · Lưu"],
    ["Waiting for the drop: 12s", "Đang chờ đến giờ săn: 12s"],
    ["Waiting for target button...", vi.statusWaitingButton],
    ["Pre-drop reload: Refreshing for fresh day quota (T - 1260ms)...", vi.statusPreDropReload],
    ["Purposeful reload: Button rendered but locked, refreshing for active state (2/3)...", "Nút vẫn khóa: tải lại trang (2/3)..."],
  ])("%s", (status, expected) => {
    expect(translateEngineStatus(status, vi, "vi")).toBe(expected);
  });

  it("click counts are localized", () => {
    expect(translateEngineStatus("Target active · 4 clicks", vi, "vi")).toBe(`Đang săn · ${vi.clicksLabel(4)}`);
  });

  it("unknown text is shown as is", () => {
    expect(translateEngineStatus("something new", vi, "vi")).toBe("something new");
  });
});

describe("marketplace sign-in / verification pages", () => {
  it("are detected by host and explained in the user's language", () => {
    const shopee = detectPlatformBlock("https://shopee.vn/verify/captcha?x=1");
    expect(shopee).toEqual({ site: "Shopee", kind: "verify" });
    expect(platformBlockMessage(shopee!, vi)).toContain("Shopee yêu cầu xác minh");
    expect(detectPlatformBlock("https://tiki.vn/customer/account/login")).toEqual({ site: "Tiki", kind: "signin" });
    expect(detectPlatformBlock("https://example.com/?next=shopee.vn/verify/")).toBeNull();
  });
});
