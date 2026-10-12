import { elementResolver, VoucherDescriptor, UniversalTargetDescriptor } from "./element_resolver";
import { humanClicker } from "./human_clicker";
import {
  ClickProfileMode,
  CLICK_PROFILES,
  computeNextInterval,
} from "./human_biometrics";
import { WorkerTimer } from "./timer_worker";
import { isSamePageUrl } from "../../lib/url";
import { isMajorMarketplace } from "./target_diagnostics";
import { PlatformTier } from "../../lib/types";
import { getAdapterForUrl } from "../adapters";

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
  /** Active biometric click profile mode: stealth, pro_gamer, turbo, or hyper. */
  clickProfileMode?: ClickProfileMode;
  maxClicks?: number;
  /** Platform classification: major_marketplace (Shopee/Lazada/TikTok) or speed_priority (caffiliate/custom). */
  platformTier?: PlatformTier;
  /** Network latency offset lead (ms) before drop moment to fire pre-emptive click. */
  preFireLeadMs?: number;
  /** Timer source; defaults to a Web Worker ticker, which keeps running in background tabs. */
  ticker?: Ticker;
  /** Enables dual-defense reload strategy: pre-warm reload at T-15s and emergency reload at T+300ms */
  dualDefenseReload?: boolean;
  /** Precision pre-reload offset lead (ms) before drop moment (default: 750ms) */
  preReloadLeadMs?: number;
  /** Custom handler for emergency reload (e.g. for testing or custom navigation) */
  onEmergencyReload?: () => void;
  onStatus?: (message: string) => void;
  onDone: (outcome: HuntOutcome) => void;
}

export const HUNT_DEFAULTS = {
  leadMs: 150,
  windowMs: 8000,
  speedPriorityWindowMs: 2000,
  defaultProfileMode: "adaptive" as ClickProfileMode,
  maxClicks: Infinity,
  speedPriorityMaxClicks: 6,
  tickMs: 10,
  speedPriorityPreFireLeadMs: 28,
};

/**
 * Runs one hunt: waits for the drop, then repeatedly re-finds the target button (nodes can be
 * replaced when countdown ends or React re-renders) and clicks it until the page shows a final state or the
 * window closes. Returns a function that cancels the hunt.
 */
export function startHunt(opts: HuntOptions): () => void {
  const effectiveTier: PlatformTier =
    opts.platformTier ??
    (typeof window !== "undefined" && window.location?.hostname && window.location.hostname !== "localhost" && !isMajorMarketplace()
      ? "speed_priority"
      : "major_marketplace");
  const preFireLeadMs =
    opts.preFireLeadMs ?? (effectiveTier === "speed_priority" ? HUNT_DEFAULTS.speedPriorityPreFireLeadMs : 0);
  const leadMs = opts.leadMs ?? HUNT_DEFAULTS.leadMs;
  const nowAtStart = opts.now();
  const isResumedAfterDrop = nowAtStart >= opts.targetTimestamp - preFireLeadMs;
  const isEmergencyReloaded =
    typeof sessionStorage !== "undefined" &&
    (Boolean(sessionStorage.getItem(`dh_emergency_reloaded_${opts.targetTimestamp}`)) ||
      Boolean(sessionStorage.getItem(`dh_reload_count_${opts.targetTimestamp}`)));
  const initialPageUrl = typeof window !== "undefined" ? window.location?.href || "" : "";
  let adapter = getAdapterForUrl(initialPageUrl);
  const defaultWindowMs =
    adapter?.windowMs !== undefined
      ? adapter.windowMs
      : effectiveTier === "speed_priority"
      ? HUNT_DEFAULTS.speedPriorityWindowMs
      : HUNT_DEFAULTS.windowMs;
  const baseWindowMs = opts.windowMs ?? defaultWindowMs;
  let windowMs = isEmergencyReloaded
    ? Math.max(baseWindowMs, effectiveTier === "speed_priority" ? 2_500 : 10_000)
    : baseWindowMs;

  // Guarantee that after a reload or late resume, there is sufficient active hunting time
  if (isResumedAfterDrop) {
    const elapsedSinceDrop = nowAtStart - opts.targetTimestamp;
    const postDropBuffer = effectiveTier === "speed_priority" ? 2_000 : 8_000;
    windowMs = Math.max(windowMs, elapsedSinceDrop + postDropBuffer);
  }
  const defaultProfile: ClickProfileMode =
    effectiveTier === "speed_priority" ? "hyper" : HUNT_DEFAULTS.defaultProfileMode;
  const profileMode = opts.clickProfileMode ?? defaultProfile;
  const profile = CLICK_PROFILES[profileMode] ?? CLICK_PROFILES.adaptive;
  let currentIntervalMs =
    opts.clickIntervalMs !== undefined
      ? opts.clickIntervalMs
      : computeNextInterval(profile, 1).intervalMs;
  const defaultMaxClicks =
    adapter?.maxClicks !== undefined
      ? adapter.maxClicks
      : effectiveTier === "speed_priority"
      ? HUNT_DEFAULTS.speedPriorityMaxClicks
      : HUNT_DEFAULTS.maxClicks;
  const maxClicks = opts.maxClicks ?? defaultMaxClicks;
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
  let keepAliveSent = false;
  let adapterPreWarmed = false;
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.removeAttribute("data-dh-checked-in");
    document.documentElement.removeAttribute("data-dh-turnstile-challenge");
  }
  let hadDisabledOnMount = Boolean(
    opts.locked && (
      opts.locked.hasAttribute("disabled") ||
      opts.locked.getAttribute("aria-disabled") === "true" ||
      (opts.locked as any).disabled
    )
  );

  const finish = (result: HuntResult, detail: string) => {
    if (done) return;
    done = true;
    ticker.stop();
    if (typeof sessionStorage !== "undefined") {
      try {
        sessionStorage.removeItem(`dh_reload_count_${opts.targetTimestamp}`);
        sessionStorage.removeItem(`dh_last_reload_time_${opts.targetTimestamp}`);
      } catch {
        // ignore
      }
    }
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

  let spinArmed = false;

  const step = () => {
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

      // Socket Keep-Alive pre-warming at T - 5s for speed priority platforms
      if (
        effectiveTier === "speed_priority" &&
        !keepAliveSent &&
        untilDrop <= 5000 &&
        untilDrop > 1000
      ) {
        keepAliveSent = true;
        if (typeof fetch === "function" && typeof window !== "undefined") {
          try {
            fetch(window.location.href, { method: "HEAD", cache: "no-store", keepalive: true }).catch(() => {});
          } catch {
            // ignore
          }
        }
      }

      // Pre-warming hook for platform adapters (e.g. Turnstile CAPTCHA & Crypto Key pre-warming on Caffiliate)
      if (
        !adapterPreWarmed &&
        untilDrop <= 3500 &&
        untilDrop > 500
      ) {
        adapterPreWarmed = true;
        if (adapter?.preWarmStrike) {
          try {
            adapter.preWarmStrike();
          } catch {
            // ignore
          }
        }
      }

      // Precision Pre-Reload at T - preReloadLeadMs: active unless dualDefenseReload is explicitly false
      const currentUrl = typeof window !== "undefined" ? window.location?.href || "" : "";
      if (currentUrl) {
        const freshAdapter = getAdapterForUrl(currentUrl);
        if (freshAdapter) adapter = freshAdapter;
      }
      const shouldDisableReload = adapter?.shouldDisableReload?.() ?? false;
      const preReloadLeadMs = opts.preReloadLeadMs ?? 750;
      const isReloadEnabled = !shouldDisableReload && opts.dualDefenseReload !== false;
      const reloadWindowMin = Math.max(200, preReloadLeadMs - 400);

      if (
        isReloadEnabled &&
        untilDrop <= preReloadLeadMs &&
        untilDrop >= reloadWindowMin &&
        clicks === 0
      ) {
        const reloadCount = typeof sessionStorage !== "undefined"
          ? parseInt(sessionStorage.getItem(`dh_reload_count_${opts.targetTimestamp}`) || "0", 10)
          : 0;
        if (reloadCount === 0) {
          const el = resolve(false);
          const isStale = Boolean(el && (el.hasAttribute("disabled") || elementResolver.getButtonState(el) === "saved"));
          if (isStale) {
            if (typeof sessionStorage !== "undefined") {
              sessionStorage.setItem(`dh_reload_count_${opts.targetTimestamp}`, "1");
              sessionStorage.setItem(`dh_last_reload_time_${opts.targetTimestamp}`, String(t));
            }
            opts.onStatus?.(`Pre-drop reload: Refreshing for fresh day quota (T - ${preReloadLeadMs}ms)...`);
            if (opts.onEmergencyReload) {
              opts.onEmergencyReload();
            } else if (typeof window !== "undefined") {
              window.location.reload();
            }
            return;
          }
        }
      }

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
          if (el && untilDrop <= 800) {
            humanClicker.preWarmStrike(el);
          }
        }
        const waitSeconds = Math.max(1, Math.round(untilDrop / 1000));
        status(t, `Waiting for the drop: ${waitSeconds}s`);
        return;
      }

      // Sub-millisecond Precision Spin-Wait:
      // When approaching fire moment (final 35ms), bypass WorkerTimer 10ms interval jitter
      // and poll via microtask queue to strike with sub-millisecond accuracy (< 0.5ms)
      if (
        !opts.ticker &&
        !spinArmed &&
        clicks === 0 &&
        untilDrop <= (preFireLeadMs + 35) &&
        untilDrop > preFireLeadMs
      ) {
        spinArmed = true;
        const spinPoll = () => {
          if (done || clicks > 0) return;
          const currentT = opts.now();
          if (currentT >= opts.targetTimestamp - preFireLeadMs) {
            step();
            return;
          }
          const remaining = (opts.targetTimestamp - preFireLeadMs) - currentT;
          if (remaining > 6) {
            if (typeof requestAnimationFrame === "function") {
              requestAnimationFrame(spinPoll);
            } else {
              setTimeout(spinPoll, 1);
            }
          } else {
            Promise.resolve().then(spinPoll);
          }
        };
        spinPoll();
      }

      if (t > opts.targetTimestamp + windowMs) {
        if (clicks === 0) {
          finish("not_found", "No matching target button appeared in time");
        } else {
          const detail =
            effectiveTier === "speed_priority"
              ? `Hyper burst dispatched (${clicks} clicks), but page never confirmed completion`
              : `Clicked ${clicks} times but target completion was not confirmed`;
          finish("timeout", detail);
        }
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
        if (clicks === 0 && untilDrop <= 800) {
          humanClicker.preWarmStrike(el);
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

      const isFireMoment = t >= opts.targetTimestamp - preFireLeadMs;
      const isLockedTarget = Boolean(isLockedHunt && el);

      // Track if target was initially disabled prior to DOM unblocking
      if (
        el &&
        !hadDisabledOnMount &&
        (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true" || (el as any).disabled)
      ) {
        hadDisabledOnMount = true;
      }

      // Speed-priority instant unblock:
      // Do not wait for React timer or re-render cycle to remove disabled attributes.
      // At fire moment (T - preFireLeadMs), unblock locked target immediately.
      if (effectiveTier === "speed_priority" && isLockedTarget && isFireMoment && el) {
        if (el.hasAttribute("disabled")) {
          try { el.removeAttribute("disabled"); } catch {}
        }
        if (el.getAttribute("aria-disabled") === "true") {
          try { el.setAttribute("aria-disabled", "false"); } catch {}
        }
        if (el.classList.contains("disabled")) {
          try { el.classList.remove("disabled"); } catch {}
        }
        if ("disabled" in el && (el as HTMLButtonElement).disabled) {
          try { (el as HTMLButtonElement).disabled = false; } catch {}
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
        if (
          (typeof document !== "undefined" && document.documentElement?.getAttribute("data-dh-checked-in") === "true") ||
          (adapter?.isButtonFinished && el && adapter.isButtonFinished(el))
        ) {
          return finish("saved", "Target confirmed completed by platform adapter");
        }

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
        // If drop has passed by at least 2s, clicks === 0, and page already explicitly marks it exhausted or saved
        const state = elementResolver.getButtonState(el);
        if (state === "exhausted") {
          return finish("exhausted", "Target voucher is already exhausted or sold out");
        }
        if (state === "saved") {
          return finish("saved", "Target is already confirmed saved for today");
        }
      }

      // 2. Guarded reload loop: reload until active button appears (window [T, T + 2500], max 3 reloads)
      // Purposeful Reload: We know button is rendered but locked/stale. Reload with purpose until active button renders!
      if (
        isReloadEnabled &&
        t >= opts.targetTimestamp &&
        t <= opts.targetTimestamp + 2500
      ) {
        const reloadCount = typeof sessionStorage !== "undefined"
          ? parseInt(sessionStorage.getItem(`dh_reload_count_${opts.targetTimestamp}`) || "0", 10)
          : 0;
        const lastReloadTime = typeof sessionStorage !== "undefined"
          ? parseInt(sessionStorage.getItem(`dh_last_reload_time_${opts.targetTimestamp}`) || "0", 10)
          : 0;

        const isButtonMissing = !el;
        const isStaleFromYesterday = Boolean(el && elementResolver.getButtonState(el) === "saved");
        const isUnclickableAtDrop = Boolean(clicks === 0 && (isButtonMissing || !isTargetClickable || isStaleFromYesterday));
        const isDeadClickProbe = Boolean(
          clicks > 0 &&
          hadDisabledOnMount &&
          t - lastClickAt >= 150
        );

        if (
          reloadCount < 3 &&
          t - lastReloadTime >= 450 &&
          (isUnclickableAtDrop || isDeadClickProbe)
        ) {
          if (typeof sessionStorage !== "undefined") {
            sessionStorage.setItem(`dh_reload_count_${opts.targetTimestamp}`, String(reloadCount + 1));
            sessionStorage.setItem(`dh_last_reload_time_${opts.targetTimestamp}`, String(t));
          }
          opts.onStatus?.(`Purposeful reload: Button rendered but locked, refreshing for active state (${reloadCount + 1}/3)...`);
          if (opts.onEmergencyReload) {
            opts.onEmergencyReload();
          } else if (typeof window !== "undefined") {
            window.location.reload();
          }
          return;
        }
      }

      // With locked target at fire moment, proactively unblock disabled attributes on DOM to strike with zero latency
      if (isFireMoment && isLockedTarget && el) {
        if (el.hasAttribute("disabled")) el.removeAttribute("disabled");
        if (el.getAttribute("aria-disabled") === "true") el.setAttribute("aria-disabled", "false");
        if (el.classList.contains("disabled")) el.classList.remove("disabled");
        if ((el as any).disabled) (el as any).disabled = false;
      }

      const state = el ? elementResolver.getButtonState(el) : "unknown";
      const isStaleBeforeDrop = clicks === 0 && isLockedTarget;

      if (
        el &&
        isFireMoment &&
        (state !== "saved" || isStaleBeforeDrop) &&
        (state === "collectable" || (isLockedTarget && isTargetClickable) || isStaleBeforeDrop) &&
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
        let directStrikeHandled = false;
        if (isFirstClick) {
          // C1-a: Capture the true baseline text right before click 1 at drop moment
          // (after countdown has transitioned to the actionable label)
          baselineTextAtDrop = elementResolver.text(el);
          if (adapter?.executeDirectStrike) {
            try {
              const res = adapter.executeDirectStrike(el);
              directStrikeHandled = Boolean(res);
            } catch {
              // ignore
            }
          }
        }
        const shouldSkipApproach = effectiveTier === "speed_priority" || profileMode === "hyper";
        const clickDispatched = isFirstClick
          ? (directStrikeHandled
              ? true
              : humanClicker.dispatchPreWarmedStrike(el, {
                  profileMode,
                  approach: isFirstClick && !shouldSkipApproach,
                  skipApproach: shouldSkipApproach,
                }))
          : humanClicker.dispatchClick(el, {
              profileMode,
              approach: false,
              skipApproach: true,
            });

        if (clickDispatched) {
          clicks++;
          lastClickAt = t;

          // Recompute next interval with biological variance and micro-pauses
          currentIntervalMs =
            opts.clickIntervalMs !== undefined
              ? opts.clickIntervalMs
              : computeNextInterval(profile, clicks + 1).intervalMs;

          // Check completion immediately after click was dispatched
          if (
            (typeof document !== "undefined" && document.documentElement?.getAttribute("data-dh-checked-in") === "true") ||
            (adapter?.isButtonFinished && el && adapter.isButtonFinished(el))
          ) {
            return finish("saved", "Target confirmed completed by platform adapter");
          }

          const activeBaseline = baselineTextAtDrop ?? initialText;
          const postCheck = elementResolver.isTargetCompleted(el, activeBaseline, clicks);
          if (postCheck.completed) {
            if (postCheck.state === "saved") return finish("saved", postCheck.reason);
            if (postCheck.state === "exhausted") return finish("exhausted", postCheck.reason);
          }
        }
      }
      const statusOverride = adapter?.getStatusOverride?.();
      status(
        t,
        statusOverride ??
          (clicks > 0
            ? clicks >= maxClicks
              ? `Burst complete (${clicks} clicks) · Awaiting server update...`
              : `Target active · ${clicks} clicks`
            : "Waiting for target button...")
      );
    } catch (err) {
      // M6: Catch uncaught errors in tick to avoid hung loop/UI
      finish("not_found", "Runtime error during hunt: " + (err as Error).message);
    }
  };

  ticker.start(HUNT_DEFAULTS.tickMs, step);

  return () => finish("cancelled", "Cancelled");
}

