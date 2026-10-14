import { MarketplaceAdapter } from "./adapter_interface";
import { elementResolver } from "../core/element_resolver";
import { Language, getTranslation } from "../../lib/i18n";
import { timeSyncClient } from "../core/time_sync_client";
import { IS_DEV_BUILD } from "../../lib/build_env";
import {
  CheckInRun,
  appendCheckInLog,
  describeAttempt,
  getCheckInLogs,
  prepSamplesFromLogs,
  serverSamplesFromLogs,
  toCheckInLogEntry,
} from "../../lib/checkin_log";
import { StrikePlan, planStrike } from "../../lib/strike_plan";

const isCaffiliateHost = (host: string) => host === "caffiliate.vn" || host.endsWith(".caffiliate.vn");
/** Local Caffiliate Bench simulator (deal-hunter/simulator, `npm run dev`): development builds only. */
const isSimulatorOrigin = (u: URL) =>
  IS_DEV_BUILD &&
  u.protocol === "http:" &&
  u.port === "3100" &&
  (u.hostname === "localhost" || u.hostname === "127.0.0.1");

/**
 * Caffiliate daily check-in. Around the drop the main-world helper (public/caffiliate_bridge.js) runs
 * at least 5 attempts on the schedule from strike_plan.ts, each walking page function -> API ->
 * button click, and stops as soon as one is confirmed. Every run's timings are logged to
 * the console and stored for the popup's Log tab.
 */
export class CaffiliateAdapter implements MarketplaceAdapter {
  platformName = "caffiliate";
  maxClicks = 1;
  windowMs = 8000;
  lastRun: CheckInRun | null = null;
  /** Attempt start -> request sent measurements from the Log history (newest runs). */
  prepSamplesMs: number[] = [];
  serverSamplesMs: number[] = [];
  plan: StrikePlan | null = null;
  /** Set when the main-world helper saw the site confirm today's check-in. */
  confirmed = false;
  /** Check-in button label when the current strike was prepared (yesterday's state), or null. */
  labelBeforeStrike: string | null = null;
  private listening = false;

  isMatchUrl(url: string): boolean {
    try {
      const u = new URL(url);
      return isCaffiliateHost(u.hostname.toLowerCase()) || isSimulatorOrigin(u);
    } catch {
      return false;
    }
  }

  /** Starts receiving runs from the main-world helper: console + popup Log tab. */
  listenForTimings(): void {
    if (this.listening || typeof window === "undefined") return;
    this.listening = true;
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      getCheckInLogs()
        .then((logs) => {
          this.prepSamplesMs = prepSamplesFromLogs(logs, 10, window.location.hostname);
          this.serverSamplesMs = serverSamplesFromLogs(logs, 10, window.location.hostname);
        })
        .catch(() => {});
    }
    window.addEventListener("dh-checkin-timing", (ev) => {
      try {
        const detail = (ev as CustomEvent).detail;
        const run = JSON.parse(typeof detail === "string" ? detail : "") as CheckInRun;
        if (typeof run?.startAt !== "number" || !Array.isArray(run.attempts)) return;
        this.lastRun = run;
        const entry = toCheckInLogEntry(run, timeSyncClient.getOffset(), window.location.hostname);
        console.info(
          `[DealHunter] Check-in ${entry.ok ? "OK" : "FAILED"}${entry.method ? ` (${entry.method})` : ""}` +
            entry.attempts.map((a) => `\n  ${describeAttempt(a)}`).join(""),
          run
        );
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          appendCheckInLog(entry)
            .then(getCheckInLogs)
            .then((logs) => {
              this.prepSamplesMs = prepSamplesFromLogs(logs, 10, window.location.hostname);
              this.serverSamplesMs = serverSamplesFromLogs(logs, 10, window.location.hostname);
            })
            .catch(() => {});
        }
      } catch {
        // ignore malformed events
      }
    });
    window.addEventListener("dh-checkin-result", (ev) => {
      try {
        const detail = (ev as CustomEvent).detail;
        const result = JSON.parse(typeof detail === "string" ? detail : "") as { ok?: boolean };
        if (result?.ok === true) this.confirmed = true;
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
    if (this.confirmed) return true;
    if (!button || !button.isConnected) return false;
    // Only the site's own confirmation counts: the check-in button turns into "Đã điểm danh #N".
    // Any popup (including errors such as "Chưa tới giờ") is not a success. During a strike the
    // button still shows yesterday's "Đã điểm danh #N" until the server answers: that label is not
    // today's check-in (the main-world helper's confirmed result is).
    const done = (el: HTMLElement) => {
      const text = elementResolver.text(el);
      if (this.labelBeforeStrike !== null && text === this.labelBeforeStrike) return false;
      return /đã điểm danh|da diem danh/i.test(text) && /#\d+/.test(text);
    };
    if (done(button)) return true;
    const realBtn = this.findCheckInButton();
    return Boolean(realBtn && realBtn !== button && done(realBtn));
  }

  confirmsCompletion(button: HTMLElement): boolean {
    return this.isButtonFinished(button);
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
    this.lastRun = null;
    this.confirmed = false;
    this.snapshotLabel();
    this.planStrike();
    if (typeof document === "undefined") return;
    if (!document.querySelector('link[rel="preconnect"][href="https://challenges.cloudflare.com"]')) {
      const link = document.createElement("link");
      link.rel = "preconnect";
      link.href = "https://challenges.cloudflare.com";
      link.crossOrigin = "anonymous";
      (document.head || document.documentElement).appendChild(link);
    }
  }

  /**
   * Check-in through the page itself: asks the main-world helper to run its attempts
   * (page function -> API -> button). No F5 and no waiting for the button to re-enable.
   */
  executeDirectStrike(): boolean {
    if (typeof window === "undefined") return false;
    this.listenForTimings();
    if (this.labelBeforeStrike === null) this.snapshotLabel();
    const plan = this.plan ?? this.planStrike();
    window.dispatchEvent(
      new CustomEvent("dh-caffiliate-strike", {
        detail: JSON.stringify({
          offsetsMs: plan.offsetsMs,
          plan: {
            attempts: plan.offsetsMs.length,
            leadMs: plan.leadMs,
            prepMs: plan.prepMs,
            oneWayMs: plan.oneWayMs,
            sigmaMs: plan.sigmaMs,
            arrivalsMs: plan.arrivalsMs,
          },
        }),
      })
    );
    return true;
  }

  private snapshotLabel(): void {
    const btn = this.findCheckInButton();
    this.labelBeforeStrike = btn ? elementResolver.text(btn) : null;
  }

  /**
   * Recomputes the attempt schedule from the current clock calibration and the Log history.
   * The engine starts the strike leadMs before the drop.
   */
  planStrike(): StrikePlan {
    this.plan = planStrike({
      rttMs: timeSyncClient.getRttMs(),
      clockErrorMs: timeSyncClient.getErrorMs(),
      prepSamplesMs: this.prepSamplesMs,
      serverSamplesMs: this.serverSamplesMs,
    });
    return this.plan;
  }

}

export const caffiliateAdapter = new CaffiliateAdapter();
