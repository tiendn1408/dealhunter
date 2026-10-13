import { MarketplaceAdapter } from "./adapter_interface";
import { elementResolver } from "../core/element_resolver";
import { Language, getTranslation } from "../../lib/i18n";
import { timeSyncClient } from "../core/time_sync_client";

/** Timings of one check-in attempt, reported by the main-world helper (epoch ms of this machine). */
export interface CheckInTiming {
  clickAt: number;
  trusted?: boolean;
  tokenStartAt?: number;
  tokenEndAt?: number;
  tokenError?: boolean;
  requestStartAt?: number;
  responseAt?: number;
  status?: number;
  /** Date header of the check-in response (1 s resolution). */
  serverDate?: string;
}

const isCaffiliateHost = (host: string) => host === "caffiliate.vn" || host.endsWith(".caffiliate.vn");

/** Server clock reading of a local epoch timestamp, as HH:mm:ss.SSS. */
function serverClock(localMs: number): string {
  const d = new Date(localMs + timeSyncClient.getOffset());
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** One-line summary: where the time went between the click and the server's answer. */
export function summarizeCheckInTiming(t: CheckInTiming): string {
  const parts = [`click ${serverClock(t.clickAt)}`];
  if (t.tokenStartAt !== undefined && t.tokenEndAt !== undefined) {
    parts.push(`Turnstile ${Math.round(t.tokenEndAt - t.tokenStartAt)}ms${t.tokenError ? " (error)" : ""}`);
  }
  if (t.requestStartAt !== undefined) {
    parts.push(`sent ${serverClock(t.requestStartAt)} (+${Math.round(t.requestStartAt - t.clickAt)}ms)`);
  }
  if (t.requestStartAt !== undefined && t.responseAt !== undefined) {
    parts.push(`server ${Math.round(t.responseAt - t.requestStartAt)}ms · HTTP ${t.status ?? "?"}`);
  }
  return parts.join(" · ");
}

/**
 * Caffiliate daily check-in. Clicks only the button the user picked, like a person would: no page
 * state is altered and the Turnstile check runs exactly as the site intends. The main-world helper
 * (public/caffiliate_bridge.js) only measures the timings of each attempt.
 */
export class CaffiliateAdapter implements MarketplaceAdapter {
  platformName = "caffiliate";
  maxClicks = 1;
  windowMs = 8000;
  lastTiming: CheckInTiming | null = null;
  private listening = false;

  isMatchUrl(url: string): boolean {
    try {
      return isCaffiliateHost(new URL(url).hostname.toLowerCase());
    } catch {
      return false;
    }
  }

  /** Starts receiving timings from the main-world helper; each attempt is logged to the console. */
  listenForTimings(): void {
    if (this.listening || typeof window === "undefined") return;
    this.listening = true;
    window.addEventListener("dh-checkin-timing", (ev) => {
      try {
        const detail = (ev as CustomEvent).detail;
        const timing = JSON.parse(typeof detail === "string" ? detail : "") as CheckInTiming;
        if (typeof timing?.clickAt !== "number") return;
        this.lastTiming = timing;
        console.info(`[DealHunter] Check-in timing: ${summarizeCheckInTiming(timing)}`, timing);
      } catch {
        // ignore malformed events
      }
    });
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
    // Only the site's own confirmation counts: the check-in button turns into "Đã điểm danh #N".
    // Any popup (including errors such as "Chưa tới giờ") is not a success.
    const done = (el: HTMLElement) => {
      const text = elementResolver.text(el);
      return /đã điểm danh|da diem danh/i.test(text) && /#\d+/.test(text);
    };
    if (done(button)) return true;
    const realBtn = this.findCheckInButton();
    return Boolean(realBtn && realBtn !== button && done(realBtn));
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
   * Called a few seconds before the drop: start collecting timings and warm the connection to
   * Cloudflare so the Turnstile iframe does not pay a fresh TLS handshake at 00:00.
   */
  preWarmStrike(): void {
    this.listenForTimings();
    this.lastTiming = null;
    if (typeof document === "undefined") return;
    if (!document.querySelector('link[rel="preconnect"][href="https://challenges.cloudflare.com"]')) {
      const link = document.createElement("link");
      link.rel = "preconnect";
      link.href = "https://challenges.cloudflare.com";
      link.crossOrigin = "anonymous";
      (document.head || document.documentElement).appendChild(link);
    }
  }

  /** Result detail for the HUD and task list: the measured timings of the attempt, if any. */
  getResultDetail(): string | null {
    return this.lastTiming ? summarizeCheckInTiming(this.lastTiming) : null;
  }
}

export const caffiliateAdapter = new CaffiliateAdapter();
