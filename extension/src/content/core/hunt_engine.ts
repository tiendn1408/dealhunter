import { elementResolver, VoucherDescriptor, UniversalTargetDescriptor } from "./element_resolver";
import { humanClicker } from "./human_clicker";
import {
  ClickProfileMode,
  CLICK_PROFILES,
  computeNextInterval,
} from "./human_biometrics";
import { WorkerTimer } from "./timer_worker";

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
  defaultProfileMode: "pro_gamer" as ClickProfileMode,
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
  const isEmergencyReloaded =
    typeof sessionStorage !== "undefined" &&
    Boolean(sessionStorage.getItem(`dh_emergency_reloaded_${opts.targetTimestamp}`));
  const baseWindowMs = opts.windowMs ?? HUNT_DEFAULTS.windowMs;
  const windowMs = isEmergencyReloaded ? Math.max(baseWindowMs, 10_000) : baseWindowMs;
  const profileMode = opts.clickProfileMode ?? HUNT_DEFAULTS.defaultProfileMode;
  const profile = CLICK_PROFILES[profileMode] ?? CLICK_PROFILES.pro_gamer;
  let currentIntervalMs =
    opts.clickIntervalMs !== undefined
      ? opts.clickIntervalMs
      : computeNextInterval(profile, 0).intervalMs;
  const maxClicks = opts.maxClicks ?? HUNT_DEFAULTS.maxClicks;
  const ticker = opts.ticker ?? new WorkerTimer();

  let universalDesc: UniversalTargetDescriptor | null =
    opts.universalDescriptor ?? (opts.locked ? elementResolver.describeUniversal(opts.locked) : null);
  let descriptor: VoucherDescriptor | null = opts.locked ? elementResolver.describe(opts.locked) : null;
  let current: HTMLElement | null = opts.locked ?? null;
  let initialText = (opts.locked ? elementResolver.text(opts.locked) : opts.universalDescriptor?.initialText) || "";

  let clicks = 0;
  let lastClickAt = -Infinity;
  let lastStatusAt = -Infinity;
  let scrolled = false;
  let done = false;

  const finish = (result: HuntResult, detail: string) => {
    if (done) return;
    done = true;
    ticker.stop();
    opts.onDone({ result, clicks, detail });
  };

  // Vouchers that could already be saved before the drop are not the drop; remembered so that,
  // without a lock or keyword, only a voucher that opens at the drop is clicked.
  const openBeforeDrop = new Set<string>();
  const key = (el: HTMLElement) => elementResolver.describe(el).cardText;

  const isLockedHunt = Boolean(opts.locked || opts.universalDescriptor);

  // Re-find the target. A locked target is the ONLY acceptable target: if it cannot be found,
  // nothing is clicked (never fall back to a different button).
  const resolve = (atDrop: boolean): HTMLElement | null => {
    let el: HTMLElement | null = null;
    if (current && current.isConnected) {
      el = current;
    } else if (universalDesc) {
      el = elementResolver.relocateUniversal(universalDesc);
      if (el) current = el;
    } else if (descriptor) {
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

    if (!atDrop) return null;
    const candidates = elementResolver
      .findCollectButtons(opts.keyword)
      .filter((el) => opts.keyword || !openBeforeDrop.has(key(el)));
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
    if (done) return;
    const t = opts.now();
    const untilDrop = opts.targetTimestamp - t;

    if (untilDrop > leadMs) {
      // Waiting: keep the target located and visible so the burst starts without searching
      if (untilDrop < 60_000) {
        if (!descriptor && !universalDesc && !opts.keyword) {
          for (const el of elementResolver.findCollectButtons()) openBeforeDrop.add(key(el));
        }
        const el = resolve(false);
        if (el && !scrolled) {
          el.scrollIntoView({ block: "center" });
          scrolled = true;
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
    if (el && !scrolled) {
      try {
        el.scrollIntoView({ block: "center" });
        scrolled = true;
      } catch {
        // ignore
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
      const check = elementResolver.isTargetCompleted(el, initialText, clicks);
      if (check.completed) {
        if (check.state === "saved") return finish("saved", check.reason);
        if (check.state === "exhausted") return finish("exhausted", check.reason);
      }

      const state = elementResolver.getButtonState(el);
      if (state === "saved") return finish("saved", "The page shows the target as saved");
      if (state === "exhausted") return finish("exhausted", "The target is fully claimed");
    }

    // 2. Autonomous fallback reload for static pages:
    // If drop time has passed by 250ms, clicks is 0, and the button is not clickable
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
      const isFirstClick = clicks === 0;
      if (humanClicker.dispatchClick(el, { profileMode, approach: isFirstClick })) {
        clicks++;
        lastClickAt = t;

        // Recompute next interval with biological variance and micro-pauses
        currentIntervalMs =
          opts.clickIntervalMs !== undefined
            ? opts.clickIntervalMs
            : computeNextInterval(profile, clicks).intervalMs;

        // Check completion immediately after click was dispatched
        const postCheck = elementResolver.isTargetCompleted(el, initialText, clicks);
        if (postCheck.completed) {
          if (postCheck.state === "saved") return finish("saved", postCheck.reason);
          if (postCheck.state === "exhausted") return finish("exhausted", postCheck.reason);
        }
      }
    }
    status(t, clicks > 0 ? `Target active · ${clicks} clicks` : "Waiting for target button...");
  });

  return () => finish("cancelled", "Cancelled");
}

