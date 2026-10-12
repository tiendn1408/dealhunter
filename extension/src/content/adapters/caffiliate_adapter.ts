import { MarketplaceAdapter } from "./adapter_interface";
import { elementResolver } from "../core/element_resolver";
import { Language, getTranslation } from "../../lib/i18n";

/**
 * Dedicated high-speed accelerator for Caffiliate rewards / check-in platform.
 * Bypasses destructive full-page reload and unlocks in-page app state directly
 * with multi-tier dynamic resilience to guarantee 00:00:00.000 server arrival.
 * 
 * Strict CSP Compliance:
 * Uses external web_accessible_resources and CustomEvent bridge instead of inline
 * script tags to completely eliminate Content Security Policy (CSP) violations.
 */
export class CaffiliateAdapter implements MarketplaceAdapter {
  platformName = "caffiliate";
  maxClicks = 1;
  windowMs = 8000;

  isMatchUrl(url: string): boolean {
    if (!url) return false;
    const lower = url.toLowerCase();
    if (
      lower.includes("caffiliate.vn") ||
      (typeof window !== "undefined" && window.location?.hostname && window.location.hostname.includes("caffiliate.vn"))
    ) {
      return true;
    }
    if (lower.includes(":3100") || lower.includes("localhost:3100")) {
      return true;
    }
    if (
      (lower.includes("localhost") || lower.includes("127.0.0.1")) &&
      typeof document !== "undefined" &&
      (document.getElementById("btnCheckIn") || document.getElementById("caffiliate-checkin-btn"))
    ) {
      return true;
    }
    return false;
  }

  /**
   * Ensures the CSP-compliant Main World bridge script is mounted into the page.
   * Loads via external script src from extension URL (permitted by page CSP) or
   * uses the pre-registered manifest content script.
   */
  ensureBridgeInjected(): void {
    if (typeof document === "undefined") return;
    if (document.getElementById("dh-caffiliate-bridge")) return;

    if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
      try {
        const script = document.createElement("script");
        script.id = "dh-caffiliate-bridge";
        script.src = chrome.runtime.getURL("caffiliate_bridge.js");
        script.async = false;
        (document.head || document.documentElement).appendChild(script);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Dynamically locates the check-in button even if ID, classes, or attributes change.
   */
  findCheckInButton(): HTMLElement | null {
    if (typeof document === "undefined") return null;

    // 1. Primary well-known IDs
    const btnCheckIn = document.getElementById("btnCheckIn");
    if (btnCheckIn) return btnCheckIn;

    const simBtn = document.getElementById("caffiliate-checkin-btn");
    if (simBtn) return simBtn;

    // 2. Attribute pattern matching
    const attrMatch = document.querySelector<HTMLElement>(
      'button[id*="CheckIn" i], button[id*="checkin" i], button[id*="diemdanh" i]'
    );
    if (attrMatch) return attrMatch;

    // 3. Text and icon content matching
    const buttons = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button']"));
    for (const b of buttons) {
      const text = elementResolver.text(b);
      if (/điểm danh|diem danh|nhận xèng|nhan xeng|check in/i.test(text)) {
        return b;
      }
    }

    return null;
  }

  findVoucherButtons(keyword?: string): HTMLElement[] {
    const list: HTMLElement[] = [];
    const btn = this.findCheckInButton();
    if (btn) list.push(btn);

    if (list.length > 0) return list;
    return elementResolver.findCollectButtons(keyword);
  }

  isButtonFinished(button: HTMLElement): boolean {
    if (!button || !button.isConnected) return false;

    // 0. Direct confirmation flag set by Main-World bridge
    if (typeof document !== "undefined" && document.documentElement.getAttribute("data-dh-checked-in") === "true") {
      return true;
    }

    // 1. Direct button text check
    const text = elementResolver.text(button);
    if ((text.includes("Đã điểm danh") || text.includes("da diem danh")) && /#\d+/.test(text)) {
      return true;
    }

    // 2. Page-level Caffiliate state check in case user pointed at heading or surrounding card
    if (typeof document !== "undefined") {
      const realBtn = this.findCheckInButton();
      if (realBtn) {
        const realText = elementResolver.text(realBtn);
        if (
          realText.includes("Đã điểm danh") ||
          realText.includes("da diem danh") ||
          realBtn.getAttribute("data-state") === "saved" ||
          /#\d+/.test(realText)
        ) {
          return true;
        }
      }
      if (
        document.querySelector(".swal2-container") ||
        document.querySelector(".swal2-popup") ||
        document.querySelector(".bg-emerald-50.border-emerald-200") ||
        document.body.innerText.includes("Hạng hôm nay")
      ) {
        return true;
      }
    }

    return elementResolver.isButtonFinished(button);
  }

  /**
   * Tells the hunting engine to strictly suppress destructive page reload (F5)
   * on Caffiliate, preventing 2-second reload latency penalties.
   */
  shouldDisableReload(): boolean {
    return true;
  }

  /**
   * Detects whether Cloudflare Turnstile Interactive Challenge is actively pending user verification.
   */
  isTurnstilePending(): boolean {
    if (typeof document === "undefined") return false;
    return Boolean(
      document.documentElement?.getAttribute("data-dh-turnstile-challenge") === "active" ||
      document.querySelector('iframe[src*="challenges.cloudflare.com"]')
    );
  }

  /**
   * Overrides HUD status prompt when Turnstile challenge is blocking check-in.
   */
  getStatusOverride(lang?: Language): string | null {
    if (this.isTurnstilePending()) {
      return getTranslation(lang || "en").turnstileChallengePrompt;
    }
    return null;
  }

  /**
   * Pre-warms Cloudflare Turnstile token and socket keep-alive at T - 3.5s before drop.
   * Eliminates the 200ms - 600ms Turnstile CAPTCHA generation lag at 00:00:00.000.
   */
  preWarmStrike(): void {
    this.ensureBridgeInjected();
    if (typeof document === "undefined") return;

    try {
      if (document.documentElement) {
        document.documentElement.removeAttribute("data-dh-checked-in");
        document.documentElement.removeAttribute("data-dh-turnstile-challenge");
        document.documentElement.removeAttribute("data-dh-strike-tier");
        document.documentElement.removeAttribute("data-dh-strike-method");
        document.documentElement.removeAttribute("data-dh-strike-latency");
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("dh-caffiliate-prewarm"));
      } else {
        document.dispatchEvent(new CustomEvent("dh-caffiliate-prewarm"));
      }
    } catch {
      // ignore
    }
  }

  /**
   * Multi-tier resilient strike execution:
   * Tier 1: Dynamic In-Page App & Function Discovery (name patterns + regex + fn.toString() code inspection)
   * Tier 2: Real DOM Button Unblocking & Native W3C Click Dispatch (triggers closure event listeners)
   * Tier 3: Direct API Fallback (POST /api/v2/xeng/check-in-secure with CSRF, Turnstile & signature)
   * Tier 4: Target Element Dispatch (respects user's manual selection without auto-snapping)
   *
   * Single Precision Shot:
   * Sends a single strike event to the Main-World bridge. The bridge executes checkIn() directly
   * on the page application without triggering concurrent duplicate clicks or Cloudflare Turnstile race conditions.
   */
  executeDirectStrike(target?: HTMLElement | null): boolean {
    if (typeof document === "undefined") return false;

    try {
      // 1. Dispatch single CSP-compliant strike event to Main-World bridge
      this.ensureBridgeInjected();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("dh-caffiliate-strike"));
      } else {
        document.dispatchEvent(new CustomEvent("dh-caffiliate-strike"));
      }

      // 2. Extension DOM unblock on the real check-in button
      const realBtn = this.findCheckInButton();
      if (realBtn) {
        realBtn.removeAttribute("disabled");
        realBtn.setAttribute("aria-disabled", "false");
        realBtn.classList.remove("disabled", "pointer-events-none");
        realBtn.style.pointerEvents = "auto";
        if ("disabled" in realBtn) {
          (realBtn as HTMLButtonElement).disabled = false;
        }
      }

      // 3. User manual selection DOM unblock (e.g. if user locked a heading/card)
      if (target && target !== realBtn) {
        target.removeAttribute("disabled");
        target.setAttribute("aria-disabled", "false");
        target.classList.remove("disabled", "pointer-events-none");
        target.style.pointerEvents = "auto";
      }

      return true;
    } catch {
      return false;
    }
  }
}

export const caffiliateAdapter = new CaffiliateAdapter();
