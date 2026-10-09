import { elementResolver, VoucherDescriptor, UniversalTargetDescriptor } from "./element_resolver";
import { humanClicker } from "./human_clicker";
import {
  ClickProfileMode,
  CLICK_PROFILES,
  computeNextInterval,
} from "./human_biometrics";
import { WorkerTimer } from "./timer_worker";
import { isSamePageUrl } from "../../lib/url";

/**
 * Outcome of one target snipe. Only what the page actually shows is reported:
 * - saved:     the target confirmed completion (button text, disabled state, aria, or DOM removal)
 * - exhausted: the voucher/quota shows out of stock / limit reached
 * - not_found: no matching button appeared during the window
 * - timeout:   we clicked, but the page never confirmed completion
 * - cancelled: the user stopped the hunt
 */
export type HuntResult = "saved" | "exhausted" | "not_found" | "timeout" | "cancelled";

export interface HuntOutcome {
  result: HuntResult;
  clicks: number;
  detail: string;
}

export interface Ticker {
  start(intervalMs: number, onTick: () => void): void;
  stop(): void;
}

export interface HuntOptions {
  /** Drop moment in server/reference time (ms). */
  targetTimestamp: number;
  /** Current server/reference time (ms). */
  now: () => number;
  /** Only vouchers whose card text contains this keyword (e.g. "50%", "500k"). */
  keyword?: string;
  /** Button the user locked in the HUD, if any. */
  locked?: HTMLElement | null;
  /** Optional pre-computed universal descriptor for the target button. */
  universalDescriptor?: UniversalTargetDescriptor;
  /** Start clicking this long before the drop to absorb clock error (ms). */
  leadMs?: number;
  /** Keep trying this long after the drop (ms). */
  windowMs?: number;
  clickIntervalMs?: number;
  /** Active biometric click profile mode: stealth, pro_gamer, or turbo. */
  clickProfileMode?: ClickProfileMode;
  maxClicks?: number;
  /** Timer source; defaults to a Web Worker ticker, which keeps running in background tabs. */
  ticker?: Ticker;
  /** Enables dual-defense reload strategy: pre-warm reload at T-15s and emergency reload at T+300ms */
  dualDefenseReload?: boolean;
  /** Custom handler for emergency reload (e.g. for testing or custom navigation) */
  onEmergencyReload?: () => void;
  onStatus?: (message: string) => void;
  onDone: (outcome: HuntOutcome) => void;
}

export const HUNT_DEFAULTS = {
  leadMs: 150,
  windowMs: 3000,
  clickIntervalMs: 35,
  defaultProfileMode: "adaptive" as ClickProfileMode,
  maxClicks: 80,
  tickMs: 10,
};

/**
 * Runs one hunt: waits for the drop, then repeatedly re-finds the target button (nodes can be
 * replaced when countdown ends or React re-renders) and clicks it until the page shows a final state or the
 * window closes. Returns a function that cancels the hunt.
 */
export function startHunt(opts: HuntOptions): () => void {
  const leadMs = opts.leadMs ?? HUNT_DEFAULTS.leadMs;
  const nowAtStart = opts.now();
  const isResumedAfterDrop = nowAtStart >= opts.targetTimestamp;
  const isEmergencyReloaded =
    typeof sessionStorage !== "undefined" &&
    Boolean(sessionStorage.getItem(`dh_emergency_reloaded_${opts.targetTimestamp}`));
  const baseWindowMs = opts.windowMs ?? HUNT_DEFAULTS.windowMs;
  let windowMs = isEmergencyReloaded ? Math.max(baseWindowMs, 10_000) : baseWindowMs;

  // Guarantee that after a reload or late resume, there is at least 8,000ms of active hunting time
  if (isResumedAfterDrop) {
    const elapsedSinceDrop = nowAtStart - opts.targetTimestamp;
    windowMs = Math.max(windowMs, elapsedSinceDrop + 8_000);
  }
  const profileMode = opts.clickProfileMode ?? HUNT_DEFAULTS.defaultProfileMode;
  const profile = CLICK_PROFILES[profileMode] ?? CLICK_PROFILES.adaptive;
  let currentIntervalMs =
    opts.clickIntervalMs !== undefined
      ? opts.clickIntervalMs
      : computeNextInterval(profile, 1).intervalMs;
  const maxClicks = opts.maxClicks ?? HUNT_DEFAULTS.maxClicks;
  const ticker = opts.ticker ?? new WorkerTimer();

  let universalDesc: UniversalTargetDescriptor | null =
    opts.universalDescriptor ?? (opts.locked ? elementResolver.describeUniversal(opts.locked) : null);
  let descriptor: VoucherDescriptor | null = opts.locked ? elementResolver.describe(opts.locked) : null;
  let current: HTMLElement | null = opts.locked ?? null;
  let initialText = (opts.locked ? elementResolver.text(opts.locked) : opts.universalDescriptor?.initialText) || "";
  let baselineTextAtDrop: string | null = null;

  let clicks = 0;
  let lastClickAt = -Infinity;
  let lastStatusAt = -Infinity;
  let scrolled = false;
  let done = false;
  const initialPageUrl = typeof window !== "undefined" ? window.location.href : "";

  const finish = (result: HuntResult, detail: string) => {
    if (done) return;
    done = true;
    ticker.stop();
    opts.onDone({ result, clicks, detail });
  };

  const isLockedHunt = Boolean(opts.locked || opts.universalDescriptor);
  if (!isLockedHunt && !opts.keyword) {
    // Decision 0 / C3: Hunting without a locked target or keyword is strictly prohibited.
    ticker.stop();
    opts.onDone({ result: "not_found", clicks: 0, detail: "No target locked" });
    return () => {};
  }

  // Re-find the target. A locked target is the ONLY acceptable target: if it cannot be found,
  // nothing is clicked (never fall back to a different button).
  const resolve = (atDrop: boolean): HTMLElement | null => {
    let el: HTMLElement | null = null;
    if (current && current.isConnected) {
      if (universalDesc && !elementResolver.matchesContentSignature(current, universalDesc)) {
        current = null;
      } else {
        el = current;
      }
    }
    if (!el && universalDesc) {
      el = elementResolver.relocateUniversal(universalDesc);
      if (el) current = el;
    } else if (!el && descriptor) {
      el = elementResolver.relocate(descriptor);
      if (el) current = el;
    }

    if (el) {
      if (!el.classList.contains("dh-target-highlight")) {
        el.classList.add("dh-target-highlight");
      }
      return el;
    }

    // If user locked a target and it cannot be relocated, NEVER fall back to another button
    if (isLockedHunt) return null;

    if (!atDrop || !opts.keyword) return null;
    const candidates = elementResolver.findCollectButtons(opts.keyword);
    current = candidates[0] ?? null;
    if (current) {
      if (!initialText) {
        initialText = elementResolver.text(current);
      }
      universalDesc = elementResolver.describeUniversal(current);
      descriptor = elementResolver.describe(current);
      if (!current.classList.contains("dh-target-highlight")) {
        current.classList.add("dh-target-highlight");
      }
    }
    return current;
  };

  const status = (t: number, message: string) => {
    if (t - lastStatusAt >= 250) {
      lastStatusAt = t;
      opts.onStatus?.(message);
    }
  };

  ticker.start(HUNT_DEFAULTS.tickMs, () => {
    try {
      if (done) return;

      // M4: Page navigation constraint (SPA pushState/redirect)
      if (
        initialPageUrl &&
        typeof window !== "undefined" &&
        !isSamePageUrl(window.location.href, initialPageUrl)
      ) {
        finish("cancelled", "Page navigated away during hunt");
        return;
      }

      const t = opts.now();
    const untilDrop = opts.targetTimestamp - t;

    if (untilDrop > leadMs) {
      // Waiting: keep the target located and visible so the burst starts without searching
      if (untilDrop < 60_000) {
        const el = resolve(false);
        if (el && !scrolled) {
          try {
            el.scrollIntoView({ block: "center" });
            scrolled = true;
          } catch {
            // ignore
          }
        }
      }
      status(t, `Waiting for the drop: ${(untilDrop / 1000).toFixed(1)}s`);
      return;
    }

    if (t > opts.targetTimestamp + windowMs) {
      if (clicks === 0) finish("not_found", "No matching target button appeared in time");
      else finish("timeout", `Clicked ${clicks} times but target completion was not confirmed`);
      return;
    }

    const el = resolve(true);
    if (el) {
      if (!scrolled) {
        try {
          el.scrollIntoView({ block: "center" });
          scrolled = true;
        } catch {
          // ignore
        }
      }
    } else if (universalDesc?.documentTop && !scrolled && typeof window !== "undefined") {
      // Lazy-load activation fallback: if target is not found and descriptor has documentTop offset,
      // scroll toward that region to trigger intersection observers and virtualized DOM mounting
      const targetScrollY = Math.max(0, universalDesc.documentTop - 250);
      if (Math.abs((window.scrollY || 0) - targetScrollY) > 200) {
        try {
          window.scrollTo({ top: targetScrollY, behavior: "instant" as ScrollBehavior });
          scrolled = true;
        } catch {
          // ignore
        }
      }
    }

    const isTargetClickable = Boolean(
      el &&
      !el.hasAttribute("disabled") &&
      el.getAttribute("aria-disabled") !== "true" &&
      !el.classList.contains("disabled")
    );

    // 1. Completion verification: ONLY valid if we clicked at least once!
    // Prevents false-positives when target button still displays yesterday's completion label
    if (clicks > 0) {
      const activeBaseline = baselineTextAtDrop ?? initialText;
      const check = elementResolver.isTargetCompleted(el, activeBaseline, clicks);
      if (check.completed) {
        if (check.state === "saved") return finish("saved", check.reason);
        if (check.state === "exhausted") return finish("exhausted", check.reason);
      }

      const state = elementResolver.getButtonState(el);
      if (state === "saved") return finish("saved", "The page shows the target as saved");
      if (state === "exhausted") return finish("exhausted", "The target is fully claimed");
    } else if (t >= opts.targetTimestamp + 2000 && el) {
      // If drop has passed by at least 2s, clicks === 0, and page already explicitly marks it exhausted
      const state = elementResolver.getButtonState(el);
      if (state === "exhausted") {
        return finish("exhausted", "Target voucher is already exhausted or sold out");
      }
    }

    // 2. Autonomous fallback reload for static pages:
    // If drop time has passed by 500ms, clicks is 0, and the button is not clickable
    // (i.e. stuck in yesterday's disabled/completed state or countdown label),
    // automatically reload the page once to load the new day/drop session!
    if (
      opts.dualDefenseReload &&
      t >= opts.targetTimestamp + 250 &&
      clicks === 0 &&
      (!el || !isTargetClickable)
    ) {
      if (typeof window !== "undefined" && typeof sessionStorage !== "undefined") {
        const emergencyKey = `dh_emergency_reloaded_${opts.targetTimestamp}`;
        if (!sessionStorage.getItem(emergencyKey)) {
          sessionStorage.setItem(emergencyKey, "true");
          opts.onStatus?.("Static page detected: Executing autonomous refresh...");
          if (opts.onEmergencyReload) {
            opts.onEmergencyReload();
          } else {
            window.location.reload();
          }
          return;
        }
      }
    }

    const isLockedTarget = Boolean(isLockedHunt && el);
    const state = el ? elementResolver.getButtonState(el) : "unknown";

    if (
      el &&
      (state === "collectable" || (isLockedTarget && isTargetClickable)) &&
      t - lastClickAt >= currentIntervalMs &&
      clicks < maxClicks
    ) {
      if (typeof window !== "undefined") {
        const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { top: 0, bottom: 0, left: 0, right: 0 };
        const viewH = window.innerHeight || document.documentElement?.clientHeight || 0;
        const viewW = window.innerWidth || document.documentElement?.clientWidth || 0;
        const isOffscreen = viewH > 0 && (rect.bottom < 0 || rect.top > viewH || rect.right < 0 || rect.left > viewW);
        if (isOffscreen) {
          try {
            el.scrollIntoView({ block: "center" });
          } catch {
            // ignore
          }
        }
      }
      const isFirstClick = clicks === 0;
      if (isFirstClick) {
        // C1-a: Capture the true baseline text right before click 1 at drop moment
        // (after countdown has transitioned to the actionable label)
        baselineTextAtDrop = elementResolver.text(el);
      }
      if (humanClicker.dispatchClick(el, { profileMode, approach: isFirstClick })) {
        clicks++;
        lastClickAt = t;

        // Recompute next interval with biological variance and micro-pauses
        currentIntervalMs =
          opts.clickIntervalMs !== undefined
            ? opts.clickIntervalMs
            : computeNextInterval(profile, clicks + 1).intervalMs;

        // Check completion immediately after click was dispatched
        const activeBaseline = baselineTextAtDrop ?? initialText;
        const postCheck = elementResolver.isTargetCompleted(el, activeBaseline, clicks);
        if (postCheck.completed) {
          if (postCheck.state === "saved") return finish("saved", postCheck.reason);
          if (postCheck.state === "exhausted") return finish("exhausted", postCheck.reason);
        }
      }
    }
    status(t, clicks > 0 ? `Target active · ${clicks} clicks` : "Waiting for target button...");
  } catch (err) {
    // M6: Catch uncaught errors in tick to avoid hung loop/UI
    finish("not_found", "Runtime error during hunt: " + (err as Error).message);
  }
  });

  return () => finish("cancelled", "Cancelled");
}

