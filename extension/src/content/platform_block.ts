import { isSiteHost } from "../lib/url";

export interface PlatformBlock {
  /** Display name: "Shopee", "Lazada", ... or the host for other sites. */
  site: string;
  kind: "verify" | "signin";
}

/** The page is a marketplace's sign-in or verification (captcha) page instead of the target page. */
export function detectPlatformBlock(href = typeof window !== "undefined" ? window.location.href : ""): PlatformBlock | null {
  let path: string;
  let host: string;
  try {
    const u = new URL(href);
    path = u.pathname.toLowerCase();
    host = u.hostname.toLowerCase();
  } catch {
    return null;
  }
  const on = (site: string) => isSiteHost(href, site);

  if (on("shopee.")) {
    if (path.startsWith("/verify/")) return { site: "Shopee", kind: "verify" };
    if (path.startsWith("/buyer/login")) return { site: "Shopee", kind: "signin" };
  }
  if (on("lazada.")) {
    if (path.includes("/verification/") || path.includes("/punish")) return { site: "Lazada", kind: "verify" };
    if (path.includes("/user/login") || path.includes("/member/login")) return { site: "Lazada", kind: "signin" };
  }
  if (on("tiki.vn")) {
    if (path.includes("/customer/account/login") || path.includes("/account/login")) return { site: "Tiki", kind: "signin" };
  }
  if (on("tiktok.com")) {
    if (path.includes("/verify") || path.includes("/security")) return { site: "TikTok Shop", kind: "verify" };
    if (path.includes("/login")) return { site: "TikTok Shop", kind: "signin" };
  }
  if (path.includes("/captcha") || path.includes("/security-check")) return { site: host, kind: "verify" };
  return null;
}
