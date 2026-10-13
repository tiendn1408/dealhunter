import React, { useState, useEffect, useRef } from "react";
import { timeSyncClient } from "../core/time_sync_client";
import { humanClicker } from "../core/human_clicker";
import { ClickProfileMode } from "../core/human_biometrics";
import { elementResolver, UniversalTargetDescriptor } from "../core/element_resolver";
import { HuntOutcome } from "../core/hunt_engine";
import { huntCoordinator, ARMED_SESSION_KEY } from "../core/hunt_coordinator";
import { targetDiagnostics } from "../core/target_diagnostics";
import { formatVN, nextDropAt, nextExactDropAt, formatCountdown, parseTimeString, formatTimeLeft } from "../../lib/drop_time";
import { storage } from "../../lib/storage";
import { Language, getTranslation } from "../../lib/i18n";
import { MESSAGE_ACTIONS } from "../../lib/constants";
import { ScheduledTask, TargetDiagnosticsSummary } from "../../lib/types";
import { isSamePageUrl } from "../../lib/url";
import { reloadTiming } from "../../lib/reload_timing";
import { IS_DEV_BUILD } from "../../lib/build_env";
import { hudBus } from "./hud_bus";
import { translateEngineStatus, platformBlockMessage } from "./status_text";
import { detectPlatformBlock } from "../platform_block";
import { getAdapterForUrl } from "../adapters";
import { DEALHUNTER_LOGO_DATA_URI } from "./logo_data";
import {
  Crosshair,
  Zap,
  X,
  Minus,
  Maximize2,
  ScanSearch,
  MousePointerClick,
  CircleCheck,
  CircleAlert,
  CircleX,
  BookmarkCheck,
  Trash2,
  CalendarClock,
  Repeat,
  Check,
  ChevronDown,
  Square,
} from "lucide-react";

interface FloatingHUDProps {
  onClose?: () => void;
  /** The HUD's host element; clicks on the HUD itself are ignored while picking a target. */
  hostElement?: HTMLElement;
  /** When true, automatically activates target picking mode upon mounting. */
  autoPick?: boolean;
}

type Tone = "idle" | "armed" | "firing" | "success" | "warning" | "error";
type TargetSlot = "quick_10s" | "quick_30s" | "midnight" | "next_minute" | "custom";

const TONE_STYLES: Record<Tone, { dot: string; text: string; ring: string }> = {
  idle: { dot: "bg-slate-500", text: "text-slate-300", ring: "ring-slate-700/60" },
  armed: { dot: "bg-amber-400 animate-pulse", text: "text-amber-200", ring: "ring-amber-500/30" },
  firing: { dot: "bg-amber-400 shadow-sm shadow-amber-400/80 animate-pulse", text: "text-amber-200 font-bold", ring: "ring-amber-500/50" },
  success: { dot: "bg-emerald-400", text: "text-emerald-200", ring: "ring-emerald-500/40" },
  warning: { dot: "bg-amber-400", text: "text-amber-200", ring: "ring-amber-500/40" },
  error: { dot: "bg-rose-400", text: "text-rose-200", ring: "ring-rose-500/40" },
};

/** The chosen button as the user sees it: its text (or label); "" when it has none. */
const formatElementIdentifier = (el: HTMLElement, desc?: UniversalTargetDescriptor | null): string => {
  const text = (desc?.initialText || el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 30 ? `${text.slice(0, 30)}…` : text;
};

type StatusState = {
  render?: (t: ReturnType<typeof getTranslation>, lang: Language) => string;
  text?: string;
  tone: Tone;
};

export const FloatingHUD: React.FC<FloatingHUDProps> = ({ onClose, hostElement, autoPick }) => {
  const [lang, setLang] = useState<Language>("en");
  const [minimized, setMinimized] = useState(false);
  const [isArmed, setIsArmed] = useState(false);
  const [calibrated, setCalibrated] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<StatusState>({
    render: (t) => t.initialHUDPrompt,
    tone: "idle",
  });

  const setStatusMsg = (
    msg:
      | { text: string; tone: Tone }
      | { render: (t: ReturnType<typeof getTranslation>, lang: Language) => string; tone: Tone }
  ) => {
    setStatus({
      render: "render" in msg ? msg.render : undefined,
      text: "text" in msg ? msg.text : undefined,
      tone: msg.tone,
    });
  };

  const [targetSlot, setTargetSlot] = useState<TargetSlot>("midnight");
  const [showMore, setShowMore] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  // "Pressed" feedback shown on the test button itself (the message line is under the open panel)
  const [testPressedAt, setTestPressedAt] = useState(0);
  // The floating "more options" panel closes when clicking anywhere else
  useEffect(() => {
    if (!showMore) return;
    const onDown = (e: PointerEvent) => {
      // Only a real click elsewhere: the test press sends synthetic events to the page's button
      if (!e.isTrusted) return;
      if (moreRef.current && !e.composedPath().includes(moreRef.current)) setShowMore(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [showMore]);
  const [customTime, setCustomTime] = useState("00:00:00");
  const [clickProfile, setClickProfile] = useState<ClickProfileMode>("adaptive");
  // Pre-reload before the drop: a plain on/off switch; the lead is measured per page (reload_timing).
  const [preReloadEnabled, setPreReloadEnabled] = useState(true);
  const [autoReloadLeadMs, setAutoReloadLeadMs] = useState(() =>
    typeof window !== "undefined" ? reloadTiming.leadFor(window.location.href) : 750
  );
  const pageDisablesReload =
    typeof window !== "undefined" && Boolean(getAdapterForUrl(window.location.href)?.shouldDisableReload?.());
  const armedTargetTimestampRef = useRef<number | null>(null);
  const [countdownStr, setCountdownStr] = useState("--:--:--.-");
  const [msLeft, setMsLeft] = useState(0);
  const [targetWallClock, setTargetWallClock] = useState("--:--:--");
  const [targetSummary, setTargetSummary] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [isTargetSaved, setIsTargetSaved] = useState(false);
  const [isDailySchedule, setIsDailySchedule] = useState(false);
  const [suggestion, setSuggestion] = useState<{ list: HTMLElement[]; index: number } | null>(null);
  const [diagnostics, setDiagnostics] = useState<TargetDiagnosticsSummary | null>(null);

  const targetElementRef = useRef<HTMLElement | null>(null);
  const universalDescRef = useRef<UniversalTargetDescriptor | null>(null);
  const savedTargetNameRef = useRef<string | null>(null);

  const t = getTranslation(lang);
  const currentHost = typeof window !== "undefined" ? window.location.hostname.replace(/^www\./, "") : "";
  const [serverDomain, setServerDomain] = useState<string>(timeSyncClient.getServerHost() || currentHost);

  // Auto-calibrate with current host on mount if needed & subscribe to calibration updates
  useEffect(() => {
    const isDomainMatch = timeSyncClient.getServerHost().replace(/^www\./, "").toLowerCase() === currentHost.toLowerCase();
    if (!timeSyncClient.getIsCalibrated() || !isDomainMatch) {
      setSyncing(true);
      timeSyncClient.init().finally(() => setSyncing(false));
    }

    const unsubscribe = timeSyncClient.onCalibrationChange((cal) => {
      setCalibrated(cal.calibrated);
      if (cal.serverHost) {
        setServerDomain(cal.serverHost.replace(/^www\./, ""));
      }
    });

    return unsubscribe;
  }, [currentHost]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    reloadTiming.load(window.location.href).then(setAutoReloadLeadMs).catch(() => {});
  }, []);

  // Helper to restore saved target for a specific URL
  const restoreTargetForUrl = (url: string) => {
    storage.getSavedTargetForUrl(url).then((saved) => {
      if (saved) {
        universalDescRef.current = saved.descriptor;
        savedTargetNameRef.current = saved.name;
        setIsTargetSaved(true);
        setTargetSlot(saved.targetSlot);
        if (saved.customTime) setCustomTime(saved.customTime);
        if (typeof saved.dualDefenseReload === "boolean") setPreReloadEnabled(saved.dualDefenseReload);

        const el = elementResolver.relocateUniversal(saved.descriptor);
        if (el) {
          targetElementRef.current = el;
          el.classList.add("dh-target-highlight");
          setTargetSummary(saved.name);
        } else {
          setTargetSummary(saved.name);
        }
        if (!huntCoordinator.getState().isArmed) {
          setStatusMsg({ render: (trans) => trans.savedTargetRestored, tone: "idle" });
        }
      } else {
        if (!huntCoordinator.getState().isArmed) {
          setStatusMsg({ render: (trans) => trans.initialHUDPrompt, tone: "idle" });
        }
      }
    });
  };

  // Restore active hunt session across reload, or saved target for this page URL on mount
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Check if there is an active session from HuntCoordinator or sessionStorage across reload
    const currentSession = huntCoordinator.getCurrentSession() || (() => {
      try {
        const raw = sessionStorage.getItem(ARMED_SESSION_KEY);
        if (raw) return JSON.parse(raw);
      } catch {}
      return null;
    })();

    if (currentSession && isSamePageUrl(currentSession.url, window.location.href)) {
      if (currentSession.targetSlot) setTargetSlot(currentSession.targetSlot as TargetSlot);
      if (currentSession.customTime) setCustomTime(currentSession.customTime);
      if (currentSession.clickProfileMode) setClickProfile(currentSession.clickProfileMode);
      const reloadSwitch = currentSession.reloadSwitch ?? currentSession.dualDefenseReload;
      if (typeof reloadSwitch === "boolean") setPreReloadEnabled(reloadSwitch);
      if (currentSession.targetTimestamp) {
        armedTargetTimestampRef.current = currentSession.targetTimestamp;
      }
      if (currentSession.descriptor) {
        universalDescRef.current = currentSession.descriptor;
        const el = elementResolver.relocateUniversal(currentSession.descriptor);
        if (el) {
          targetElementRef.current = el;
          el.classList.add("dh-target-highlight");
        }
      }
      if (currentSession.label) {
        setTargetSummary(currentSession.label);
      }

      setIsArmed(true);
      setStatusMsg({
        render: (trans) => trans.sessionRestoredAfterReload,
        tone: "armed",
      });
      return;
    }

    restoreTargetForUrl(window.location.href);
  }, []);

  // Watch for SPA URL navigation (popstate, hashchange, or History pushState/replaceState)
  useEffect(() => {
    if (typeof window === "undefined") return;

    let currentUrl = window.location.href;

    const checkSpaNavigation = () => {
      const nextUrl = window.location.href;
      if (nextUrl === currentUrl) return;

      const prevUrl = currentUrl;
      currentUrl = nextUrl;

      if (!isSamePageUrl(prevUrl, nextUrl)) {
        if (huntCoordinator.getState().isArmed) {
          huntCoordinator.disarm(false);
          setStatusMsg({ render: (trans) => trans.disarmedStatus, tone: "warning" });
        }

        if (targetElementRef.current) {
          targetElementRef.current.classList.remove("dh-target-highlight");
          targetElementRef.current = null;
        }
        universalDescRef.current = null;
        savedTargetNameRef.current = null;
        setTargetSummary(null);
        setIsTargetSaved(false);
        setDiagnostics(null);

        restoreTargetForUrl(nextUrl);

        const newHost = window.location.hostname.replace(/^www\./, "");
        setServerDomain(newHost || window.location.hostname || "universal");
      }
    };

    window.addEventListener("popstate", checkSpaNavigation);
    window.addEventListener("hashchange", checkSpaNavigation);
    const pollInterval = setInterval(checkSpaNavigation, 300);

    return () => {
      window.removeEventListener("popstate", checkSpaNavigation);
      window.removeEventListener("hashchange", checkSpaNavigation);
      clearInterval(pollInterval);
    };
  }, [lang, t]);

  // Load saved click profile from settings on mount
  useEffect(() => {
    storage.getSettings().then((s) => {
      if (s.clickProfileMode) setClickProfile(s.clickProfileMode);
    });
  }, []);

  // Continuous target locator: observes DOM mutations & polls to ensure target highlight is NEVER lost on reload/SPAs (M7: throttled)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const attemptRelocate = () => {
      if (!universalDescRef.current) return;

      if (targetElementRef.current && targetElementRef.current.isConnected) {
        if (!targetElementRef.current.classList.contains("dh-target-highlight")) {
          targetElementRef.current.classList.add("dh-target-highlight");
        }
        return;
      }

      const el = elementResolver.relocateUniversal(universalDescRef.current);
      if (el) {
        targetElementRef.current = el;
        el.classList.add("dh-target-highlight");
        const name = (savedTargetNameRef.current || formatElementIdentifier(el, universalDescRef.current)).trim();
        setTargetSummary(name);
      }
    };

    attemptRelocate();
    const interval = setInterval(attemptRelocate, 350);

    let relocateThrottleTimer: ReturnType<typeof setTimeout> | null = null;
    const throttledRelocate = () => {
      if (relocateThrottleTimer) return;
      relocateThrottleTimer = setTimeout(() => {
        relocateThrottleTimer = null;
        attemptRelocate();
      }, 150);
    };

    let observer: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined" && document.body) {
      observer = new MutationObserver(throttledRelocate);
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      clearInterval(interval);
      if (relocateThrottleTimer) clearTimeout(relocateThrottleTimer);
      observer?.disconnect();
    };
  }, [t.targetButtonDefault]);

  const getResultView = (result: HuntOutcome["result"]): { text: string; tone: Tone } => {
    const tones: Record<HuntOutcome["result"], Tone> = {
      saved: "success",
      exhausted: "warning",
      not_found: "error",
      timeout: "warning",
      cancelled: "idle",
    };
    return {
      text: t.outcome[result],
      tone: tones[result],
    };
  };

  // Subscribe to unified huntCoordinator state (single source of truth for both manual Arm and Schedule)
  useEffect(() => {
    return huntCoordinator.subscribe((coordState) => {
      setIsArmed(coordState.isArmed);
      if (coordState.targetTimestamp) {
        armedTargetTimestampRef.current = coordState.targetTimestamp;
      } else if (!coordState.isArmed) {
        armedTargetTimestampRef.current = null;
      }
      if (coordState.targetSummary) {
        setTargetSummary(coordState.targetSummary);
      } else if (!coordState.isArmed && !universalDescRef.current && !targetElementRef.current) {
        setTargetSummary(null);
      }
      if (coordState.outcome) {
        const outcome = coordState.outcome;
        const view = getResultView(outcome.result);
        setStatusMsg({
          render: (trans) => `${trans.outcome[outcome.result]} · ${trans.clicksLabel(outcome.clicks)}`,
          tone: view.tone,
        });
      } else if (coordState.statusText) {
        const text = coordState.statusText;
        setStatusMsg({
          render: (trans, currentLang) => translateEngineStatus(text, trans, currentLang),
          tone: coordState.tone,
        });
      }
    });
  }, []);

  // Initialize language from settings & listen for changes
  useEffect(() => {
    storage.getLanguage().then((storedLang) => {
      setLang(storedLang);
    });

    const onChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.dh_settings?.newValue?.language) {
        const next = changes.dh_settings.newValue.language as Language;
        setLang(next);
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  // Switch target slot & clear any armed timestamp
  const handleSelectSlot = (slot: TargetSlot) => {
    if (isArmed) return;
    setTargetSlot(slot);
    armedTargetTimestampRef.current = null;
    if (slot === "custom") {
      // Only when the user picks "Giờ khác": put the cursor in the time field, ready to type.
      setTimeout(() => {
        const input = document.getElementById("dh-custom-time") as HTMLInputElement | null;
        input?.focus();
        input?.select();
      }, 0);
    }
  };

  // Target timestamp calculation
  const computeTargetTimestamp = (now: number, mode: TargetSlot): { timestamp: number; label: string } => {
    if (isArmed && armedTargetTimestampRef.current) {
      return {
        timestamp: armedTargetTimestampRef.current,
        label: formatVN(armedTargetTimestampRef.current).slice(0, 8),
      };
    }
    if (mode === "quick_10s") {
      return { timestamp: now + 10_000, label: "+10s" };
    }
    if (mode === "quick_30s") {
      return { timestamp: now + 30_000, label: "+30s" };
    }
    if (mode === "next_minute") {
      const at = Math.floor(now / 60000) * 60000 + 60000;
      return { timestamp: at, label: formatVN(at).slice(0, 8) };
    }
    if (mode === "midnight") {
      const at = nextDropAt(0, 0, now, 0);
      return { timestamp: at, label: "00:00:00" };
    }
    if (mode === "custom") {
      const parsed = parseTimeString(customTime);
      if (!parsed.valid) {
        return { timestamp: 0, label: "--:--:--" };
      }
      const at = nextExactDropAt(parsed.h, parsed.m, parsed.s, now);
      return { timestamp: at, label: parsed.formatted };
    }
    return { timestamp: now + 10_000, label: "--:--:--" };
  };

  // Clock display loop (50ms interval)
  useEffect(() => {
    const updateClock = () => {
      const now = timeSyncClient.getServerTime();
      setCalibrated(timeSyncClient.getIsCalibrated());
      const host = timeSyncClient.getServerHost();
      if (host) setServerDomain(host.replace(/^www\./, ""));

      const { timestamp } = computeTargetTimestamp(now, targetSlot);

      let effectiveTimestamp = timestamp;
      if (isArmed && armedTargetTimestampRef.current) {
        effectiveTimestamp = armedTargetTimestampRef.current;
      }
      setTargetWallClock(formatVN(effectiveTimestamp).slice(0, 8));

      let diff = 0;
      if (!isArmed && targetSlot === "quick_10s") {
        diff = 10_000;
      } else if (!isArmed && targetSlot === "quick_30s") {
        diff = 30_000;
      } else {
        diff = Math.max(0, effectiveTimestamp - now);
      }

      setCountdownStr(formatCountdown(diff));
      setMsLeft(diff);

      // Auto-reconnect target element if disconnected or hydrating after reload / SPA navigation
      if (universalDescRef.current && (!targetElementRef.current || !targetElementRef.current.isConnected)) {
        const el = elementResolver.relocateUniversal(universalDescRef.current);
        if (el) {
          targetElementRef.current = el;
          el.classList.add("dh-target-highlight");
        }
      }
    };

    updateClock();
    const interval = setInterval(updateClock, 50);
    return () => clearInterval(interval);
  }, [targetSlot, customTime, isArmed]);

  useEffect(() => {
    return () => {
      cleanupPickerRef.current?.();
      if (targetElementRef.current) {
        targetElementRef.current.classList.remove("dh-target-highlight");
      }
    };
  }, []);

  const handleClose = () => {
    if (isArmed) {
      huntCoordinator.disarm(true);
    }
    if (targetElementRef.current) {
      targetElementRef.current.classList.remove("dh-target-highlight");
      targetElementRef.current = null;
    }
    cleanupPickerRef.current?.();
    onClose?.();
  };

  const isOwnElement = (el: HTMLElement | null) => !!hostElement && (hostElement === el || hostElement.contains(el));
  const isOwnEvent = (e: Event) => !!hostElement && e.composedPath().includes(hostElement);

  const lockTarget = (el: HTMLElement) => {
    document.querySelectorAll(".dh-target-suggest").forEach((n) => n.classList.remove("dh-target-suggest"));
    setSuggestion(null);
    targetElementRef.current?.classList.remove("dh-target-highlight");
    el.classList.add("dh-target-highlight");
    targetElementRef.current = el;
    universalDescRef.current = elementResolver.describeUniversal(el);

    const desc = universalDescRef.current;
    const name = formatElementIdentifier(el, desc);
    setTargetSummary(name);
    // Remembered right away for this page: next visit (and the popup / schedules) know the button
    void handleSaveTarget(desc, name, true);

    // Reset previous hunt outcome in coordinator so old outcome won't linger
    huntCoordinator.resetOutcome();

    // Fast synchronous inspection
    const instant = targetDiagnostics.inspect(el);
    setDiagnostics(instant);

    // Comprehensive async analysis (samples countdown ticking)
    targetDiagnostics.analyze(el).then((diag) => {
      setDiagnostics(diag);
    });
  };

  const handleSaveTarget = async (
    descArg?: UniversalTargetDescriptor | null,
    nameArg?: string,
    silent = false
  ) => {
    const desc = descArg ?? universalDescRef.current;
    if (!desc || typeof window === "undefined") return;
    const name = (nameArg || targetSummary || desc.initialText || t.targetButtonDefault).trim() || t.targetButtonDefault;
    const existing = await storage.getSavedTargetForUrl(window.location.href);
    await storage.savePageTarget({
      id: existing ? existing.id : `target_${Date.now()}`,
      url: window.location.href,
      origin: window.location.origin,
      name,
      targetSlot,
      customTime: targetSlot === "custom" ? customTime : undefined,
      descriptor: desc,
      dualDefenseReload: preReloadEnabled,
      diagnostics: diagnostics || undefined,
      updatedAt: Date.now(),
    });
    setIsTargetSaved(true);
    if (!silent) setStatusMsg({ render: (trans) => trans.targetSavedSuccess, tone: "success" });
  };

  const handleForgetSavedTarget = async () => {
    if (typeof window === "undefined") return;

    // M16: Clear element highlight in DOM
    if (targetElementRef.current) {
      targetElementRef.current.classList.remove("dh-target-highlight");
      targetElementRef.current = null;
    }

    // M16: Clear descriptor refs, name, and diagnostics so it is not used in Arm
    universalDescRef.current = null;
    savedTargetNameRef.current = null;
    setTargetSummary(null);
    setDiagnostics(null);

    // Clear hunt coordinator state so stale target or outcome are never resurrected
    huntCoordinator.clearTargetAndOutcome();

    if (typeof sessionStorage !== "undefined") {
      try {
        sessionStorage.removeItem(ARMED_SESSION_KEY);
      } catch {
        // ignore
      }
    }

    try {
      const existing = await storage.getSavedTargetForUrl(window.location.href);
      if (existing) {
        await storage.removePageTarget(existing.id);
      }
    } catch {
      // ignore
    }

    setIsTargetSaved(false);
    setStatusMsg({ render: (trans) => trans.targetForgotten, tone: "idle" });
  };

  const handleScheduleFromHUD = async () => {
    if (!universalDescRef.current || typeof window === "undefined") return;
    const now = timeSyncClient.getServerTime();
    const { timestamp } = computeTargetTimestamp(now, targetSlot);
    // The task stores a clock time (a daily task repeats it), so the label is that time, not "+10s"
    const timeLabel = formatVN(timestamp).slice(0, 8);
    const date = new Date(timestamp + 7 * 3600 * 1000); // VN time
    const h = date.getUTCHours();
    const m = date.getUTCMinutes();
    const s = date.getUTCSeconds();

    await handleSaveTarget(undefined, undefined, true);

    const saved = await storage.getSavedTargetForUrl(window.location.href);
    const name = (targetSummary || t.targetButtonDefault).trim();

    const task: ScheduledTask = {
      id: Math.random().toString(36).substring(2, 9),
      targetHour: h,
      targetMinute: m,
      targetSecond: s,
      targetUrl: window.location.href,
      label: `${timeLabel} · ${name}`,
      mode: "full_auto",
      isDaily: isDailySchedule,
      savedTargetId: saved?.id,
      descriptor: universalDescRef.current,
      preWarmSeconds: 60,
      dualDefenseReload: preReloadEnabled,
      diagnostics: diagnostics || undefined,
      status: "pending",
      createdAt: Date.now(),
    };

    try {
      await chrome.runtime.sendMessage({
        action: MESSAGE_ACTIONS.SCHEDULE_TASK,
        task,
      });
      setStatusMsg({
        render: (trans) => (isDailySchedule ? trans.quickScheduleDailySuccess : trans.quickScheduleSuccess),
        tone: "success",
      });
    } catch (err) {
      console.warn("Schedule from HUD failed:", err);
      // L4: Show error in status instead of console only
      setStatusMsg({ text: (err as Error).message || "Scheduling failed", tone: "error" });
    }
  };

  const cleanupPickerRef = useRef<(() => void) | null>(null);

  // Pick target with pointerdown and visual hover overlay
  const handleSelectTarget = () => {
    if (picking) {
      cleanupPickerRef.current?.();
      setStatusMsg({
        render: (trans) => (universalDescRef.current ? trans.targetLockedInstruction : trans.initialHUDPrompt),
        tone: "idle",
      });
      return;
    }

    setPicking(true);
    document.body.classList.add("dh-picking-active");
    setStatusMsg({
      render: (trans) => trans.pickInstruction,
      tone: "armed",
    });

    let overlayEl = document.getElementById("dh-picker-overlay");
    if (!overlayEl) {
      overlayEl = document.createElement("div");
      overlayEl.id = "dh-picker-overlay";
      document.body.appendChild(overlayEl);
    }
    overlayEl.style.display = "none";

    const cleanup = () => {
      setPicking(false);
      document.body.classList.remove("dh-picking-active");
      if (overlayEl) {
        overlayEl.remove();
      }
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("pointerdown", onPick, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("contextmenu", onContextMenu);
      cleanupPickerRef.current = null;
    };
    cleanupPickerRef.current = cleanup;

    const onMouseMove = (e: MouseEvent) => {
      if (isOwnEvent(e)) {
        if (overlayEl) overlayEl.style.display = "none";
        return;
      }

      const rawTarget = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      if (!rawTarget || isOwnElement(rawTarget) || rawTarget === document.body || rawTarget === document.documentElement) {
        if (overlayEl) overlayEl.style.display = "none";
        return;
      }

      const target = elementResolver.normalizeTarget(rawTarget);
      const rect = target.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        if (overlayEl) overlayEl.style.display = "none";
        return;
      }

      overlayEl.style.display = "block";
      overlayEl.style.top = `${rect.top}px`;
      overlayEl.style.left = `${rect.left}px`;
      overlayEl.style.width = `${rect.width}px`;
      overlayEl.style.height = `${rect.height}px`;

      const text = elementResolver.text(target);
      const tag = target.tagName.toLowerCase();
      const displayLabel = text ? (text.length > 20 ? text.slice(0, 20) + "..." : text) : (target.id ? `#${target.id}` : tag);
      while (overlayEl.firstChild) {
        overlayEl.removeChild(overlayEl.firstChild);
      }
      const badge = document.createElement("div");
      badge.id = "dh-picker-badge";
      if (rect.top < 30) {
        badge.style.bottom = "-26px";
      } else {
        badge.style.top = "-26px";
      }
      badge.textContent = `${t.pickerBadgePrefix} · ${tag} "${displayLabel}"`;
      overlayEl.appendChild(badge);

      setStatusMsg({
        render: (trans) => trans.targetingBadge(tag, displayLabel),
        tone: "armed",
      });
    };

    const onPick = (e: PointerEvent) => {
      if (isOwnEvent(e)) return;
      e.preventDefault();
      e.stopPropagation();

      const rawTarget = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      if (!rawTarget || isOwnElement(rawTarget) || rawTarget === document.body || rawTarget === document.documentElement) {
        cleanup();
        setStatusMsg({
          render: (trans) => (universalDescRef.current ? trans.targetLockedInstruction : trans.initialHUDPrompt),
          tone: "idle",
        });
        return;
      }

      const el = elementResolver.normalizeTarget(rawTarget);
      if (!el || isOwnElement(el) || el === document.body || el === document.documentElement) {
        cleanup();
        setStatusMsg({
          render: (trans) => (universalDescRef.current ? trans.targetLockedInstruction : trans.initialHUDPrompt),
          tone: "idle",
        });
        return;
      }

      lockTarget(el);
      cleanup();
      setStatusMsg({ render: (trans) => trans.targetLockedInstruction, tone: "idle" });

      // Swallow the click event following pointerdown to prevent accidental early triggering
      const swallow = (ev: MouseEvent) => {
        if (!el.contains(ev.target as Node)) return;
        ev.preventDefault();
        ev.stopPropagation();
        window.removeEventListener("click", swallow, true);
      };
      window.addEventListener("click", swallow, true);
      setTimeout(() => window.removeEventListener("click", swallow, true), 600);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cleanup();
        setStatusMsg({
          render: (trans) => (universalDescRef.current ? trans.targetLockedInstruction : trans.initialHUDPrompt),
          tone: "idle",
        });
      }
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      cleanup();
      setStatusMsg({
        render: (trans) => (universalDescRef.current ? trans.targetLockedInstruction : trans.initialHUDPrompt),
        tone: "idle",
      });
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("pointerdown", onPick, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("contextmenu", onContextMenu);
  };

  const pickingRef = useRef(picking);
  pickingRef.current = picking;

  useEffect(() => {
    if (autoPick) {
      const timer = setTimeout(() => {
        handleSelectTarget();
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [autoPick]);

  useEffect(() => {
    const onActivatePick = () => {
      if (minimized) {
        setMinimized(false);
      }
      if (!pickingRef.current) {
        handleSelectTarget();
      }
    };
    return hudBus.onPickRequest(onActivatePick);
  }, [minimized]);

  // Development builds only: the Caffiliate Bench simulator sets the drop time through a page event.
  // A production build ignores it (any page could send it).
  useEffect(() => {
    if (!IS_DEV_BUILD) return;
    const onSetTargetTime = (e: Event) => {
      const customEvent = e as CustomEvent<{ timeStr?: string; timestamp?: number }>;
      if (customEvent.detail?.timeStr && !huntCoordinator.getState().isArmed) {
        setTargetSlot("custom");
        setCustomTime(customEvent.detail.timeStr);
        armedTargetTimestampRef.current = null;
        setStatusMsg({
          render: (trans) => trans.targetTimeSynced(customEvent.detail!.timeStr!),
          tone: "idle",
        });
      }
    };
    window.addEventListener("dealhunter:set-target-time", onSetTargetTime);
    return () => window.removeEventListener("dealhunter:set-target-time", onSetTargetTime);
  }, []);

  // Auto-detect only SUGGESTS a button (decision 1): it is outlined and the user confirms it (or looks
  // at the next one). Nothing is locked, armed or clicked without that confirmation.
  const clearSuggestion = () => {
    suggestion?.list[suggestion.index]?.classList.remove("dh-target-suggest");
    setSuggestion(null);
  };

  const showSuggestion = (list: HTMLElement[], index: number) => {
    suggestion?.list[suggestion.index]?.classList.remove("dh-target-suggest");
    const el = list[index];
    el.classList.add("dh-target-suggest");
    try {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch {
      // ignore
    }
    setSuggestion({ list, index });
    const label = elementResolver.text(el).slice(0, 40) || "?";
    setStatusMsg({ render: (trans) => trans.autoDetectSuggest(label, index + 1, list.length), tone: "idle" });
  };

  const handleAutoDetect = () => {
    if (picking) {
      cleanupPickerRef.current?.();
    }
    const adapter = typeof window !== "undefined" ? getAdapterForUrl(window.location.href) : null;
    const buttons = adapter?.findVoucherButtons ? adapter.findVoucherButtons() : elementResolver.findCollectButtons();
    if (buttons.length > 0) {
      showSuggestion(buttons, 0);
    } else {
      clearSuggestion();
      setStatusMsg({ render: (trans) => trans.noButtonFound, tone: "error" });
    }
  };

  const acceptSuggestion = () => {
    if (!suggestion) return;
    const el = suggestion.list[suggestion.index];
    clearSuggestion();
    if (el?.isConnected) lockTarget(el);
  };

  const armHunt = (overrideTimestamp?: number) => {
    if (!targetElementRef.current && !universalDescRef.current) {
      setStatusMsg({ render: (trans) => trans.noTargetSelected, tone: "error" });
      return;
    }

    if (targetSlot === "custom" && !overrideTimestamp) {
      const parsed = parseTimeString(customTime);
      if (!parsed.valid) {
        setStatusMsg({ render: (trans) => trans.invalidTimeFormat, tone: "error" });
        return;
      }
    }

    const block = detectPlatformBlock();
    if (block) {
      setStatusMsg({ render: (trans) => platformBlockMessage(block, trans), tone: "error" });
      return;
    }

    const now = timeSyncClient.getServerTime();

    let timestamp: number;
    if (overrideTimestamp) {
      timestamp = overrideTimestamp;
    } else if (targetSlot === "quick_10s") {
      timestamp = now + 10_000;
    } else if (targetSlot === "quick_30s") {
      timestamp = now + 30_000;
    } else {
      timestamp = computeTargetTimestamp(now, targetSlot).timestamp;
    }

    void handleSaveTarget(undefined, undefined, true);
    armedTargetTimestampRef.current = timestamp;
    setIsArmed(true);
    setStatusMsg({ render: (trans) => trans.armedWaitingDrop, tone: "armed" });

    huntCoordinator.arm({
      targetTimestamp: timestamp,
      targetElement: targetElementRef.current,
      descriptor: universalDescRef.current,
      targetSlot,
      customTime: targetSlot === "custom" ? customTime : undefined,
      label: targetSummary || undefined,
      clickProfileMode: clickProfile,
      dualDefenseReload: preReloadEnabled,
      diagnostics: diagnostics || undefined,
    });
  };

  const disarmHunt = () => {
    huntCoordinator.disarm();
    armedTargetTimestampRef.current = null;
    setIsArmed(false);
    setStatusMsg({ render: (trans) => trans.disarmedStatus, tone: "idle" });
  };

  const handleManualTestClick = () => {
    // Only the picked button is ever clicked, test clicks included
    if (!targetElementRef.current) {
      setStatusMsg({ render: (trans) => trans.noTargetSelected, tone: "error" });
      return;
    }
    humanClicker.dispatchClick(targetElementRef.current, { profileMode: clickProfile, approach: true });
    setStatusMsg({ render: (trans) => trans.testClickSuccess, tone: "idle" });
    const at = Date.now();
    setTestPressedAt(at);
    setTimeout(() => setTestPressedAt((cur) => (cur === at ? 0 : cur)), 1500);
  };

  const handleRecalibrate = async () => {
    setSyncing(true);
    setStatusMsg({ render: (trans) => trans.syncingClock, tone: "idle" });
    await timeSyncClient.calibrate();
    setSyncing(false);
    setStatusMsg({
      render: (trans) =>
        timeSyncClient.getIsCalibrated() ? trans.syncedClockSuccess : trans.syncedClockFailed,
      tone: timeSyncClient.getIsCalibrated() ? "success" : "error",
    });
  };

  // Draggable header handler
  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button") || (e.target as HTMLElement).closest("input")) return;

    const rootEl =
      hostElement ||
      (typeof document !== "undefined" ? document.getElementById("dealhunter-hud-root") : null) ||
      ((e.currentTarget as HTMLElement).closest(".dh-floating-card") as HTMLElement | null);
    if (!rootEl) return;

    const rect = rootEl.getBoundingClientRect();
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startX = rect.left;
    const startY = rect.top;

    let hasDragged = false;

    const onMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startMouseX;
      const dy = ev.clientY - startMouseY;

      // 4px threshold prevents accidental tiny mouse twitches during normal clicks
      if (!hasDragged) {
        if (Math.hypot(dx, dy) < 4) return;
        hasDragged = true;
      }

      ev.preventDefault();

      const elWidth = rootEl.offsetWidth || 356;
      const elHeight = rootEl.offsetHeight || 480;
      const newX = Math.max(8, Math.min(window.innerWidth - elWidth - 8, startX + dx));
      const newY = Math.max(8, Math.min(window.innerHeight - elHeight - 8, startY + dy));

      rootEl.style.setProperty("left", `${newX}px`, "important");
      rootEl.style.setProperty("top", `${newY}px`, "important");
      rootEl.style.setProperty("right", "auto", "important");
      rootEl.style.setProperty("bottom", "auto", "important");
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const tone = TONE_STYLES[status.tone];
  const statusDisplayText = status.render ? status.render(t, lang) : (status.text || "");
  const StatusIcon =
    status.tone === "success" ? CircleCheck : status.tone === "error" ? CircleX : status.tone === "warning" ? CircleAlert : null;
  const hasTarget = Boolean(targetSummary || targetElementRef.current || universalDescRef.current);
  const timeInvalid = targetSlot === "custom" && !parseTimeString(customTime).valid;
  const canStart = hasTarget && !timeInvalid;
  const leftWords = formatTimeLeft(msLeft, t);
  const buttonName = targetSummary || t.targetButtonDefault;
  const repeatsTheCards =
    [t.initialHUDPrompt, t.savedTargetRestored, t.targetLockedInstruction, t.armedWaitingDrop, t.sessionRestoredAfterReload].includes(
      statusDisplayText
    ) || (isArmed && status.tone === "armed");
  const showStatus = Boolean(statusDisplayText) && !repeatsTheCards;

  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        aria-label={t.hudExpand}
        title={t.hudExpand}
        className="dh-minimized-pill flex items-center gap-2.5 rounded-full px-4 py-2 text-white shadow-2xl ring-1 ring-white/10 transition hover:ring-emerald-400/50"
      >
        <img src={DEALHUNTER_LOGO_DATA_URI} alt="" className="h-5 w-5 rounded-md" />
        {isArmed ? (
          <>
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[12px] font-semibold text-amber-200">{t.homeTimeLeft(leftWords)}</span>
          </>
        ) : (
          <span className="text-[12px] font-semibold text-slate-200">DealHunter</span>
        )}
        <Maximize2 className="h-3.5 w-3.5 text-slate-400" />
      </button>
    );
  }

  // Plain step numbers, no ticks: a remembered button or the default time would show as "done"
  // before the user did anything; the cards themselves show what is set.
  const step = (n: number) => (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold text-slate-300">
      {n}
    </span>
  );

  return (
    <div className="dh-floating-card w-[356px] select-none overflow-hidden rounded-3xl text-slate-100 ring-1 ring-white/10">
      {showMore && <div className="dh-more-backdrop" aria-hidden="true" />}
      {/* Header: drag to move */}
      <div
        onMouseDown={handleHeaderMouseDown}
        title={t.dragHudTooltip}
        className="dh-header flex cursor-grab items-center justify-between gap-2 px-3.5 py-2.5 active:cursor-grabbing select-none"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <img src={DEALHUNTER_LOGO_DATA_URI} alt="" className="h-8 w-8 shrink-0 rounded-xl object-cover shadow-lg shadow-emerald-900/50" />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-[14px] font-bold tracking-tight text-white">DealHunter</div>
            <div className="truncate text-[11px] font-medium text-slate-400">{t.hudSubtitle(currentHost)}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMinimized(true)}
            className="dh-header-btn dh-header-btn-square"
            title={t.minimize}
            aria-label={t.minimize}
          >
            <Minus className="h-3.5 w-3.5 shrink-0" />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={handleClose}
              className="dh-header-btn dh-header-btn-square dh-header-btn-close"
              title={t.close}
              aria-label={t.close}
            >
              <X className="h-3.5 w-3.5 shrink-0" />
            </button>
          )}
        </div>
      </div>

      <div className="dh-hud-body space-y-2.5 px-3.5 pb-3.5 pt-2.5">
        {isArmed ? (
          /* Hunting: one clear screen, the only action is to stop */
          <div className="dh-inner-card rounded-2xl p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 text-[12px] font-semibold text-amber-300">
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              {t.armedTitle}
            </div>
            <div className="mt-2 font-mono text-[34px] font-bold leading-none text-white tabular-nums">
              {countdownStr.slice(0, 8)}
            </div>
            <div className="mt-2 text-[12px] text-slate-300">
              {t.huntAt(targetWallClock)} · <span className="font-semibold text-emerald-300">«{buttonName}»</span>
            </div>
          </div>
        ) : (
          <>
            {/* Step 1: the button */}
            <section className="dh-inner-card rounded-2xl p-3">
              <div className="mb-2 flex items-center gap-2">
                {step(1)}
                <h3 className="text-[13px] font-semibold text-slate-100">{t.step1Title}</h3>
              </div>

              <div className="dh-step1-body">
              {picking ? (
                /* Same place and size as "Pick a button": pressing again where it was cancels */
                <div className="flex flex-col gap-2">
                  <button type="button" onClick={handleSelectTarget} className="dh-arm-btn dh-arm-btn-rose">
                    <X className="h-4 w-4" />
                    <span>{t.cancelPick}</span>
                  </button>
                  <p className="dh-sub-btn" style={{ cursor: "default" }}>
                    <span className="text-amber-200">{t.pickInstruction}</span>
                  </p>
                </div>
              ) : hasTarget ? (
                <div className="flex h-full items-center justify-between gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 ring-1 ring-emerald-500/25">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-emerald-200" title={buttonName}>
                      «{buttonName}»
                    </div>
                    {isTargetSaved && (
                      <div className="flex items-center gap-1 text-[10px] text-emerald-400/80">
                        <BookmarkCheck className="h-2.5 w-2.5" />
                        {t.savedForPage}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleSelectTarget}
                    className="dh-sub-btn dh-sub-btn-auto shrink-0"
                  >
                    <Crosshair className="h-3 w-3" />
                    <span>{t.changeButton}</span>
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <button type="button" onClick={handleSelectTarget} className="dh-arm-btn dh-arm-btn-emerald">
                    <Crosshair className="h-4 w-4" />
                    <span>{t.pickButton}</span>
                  </button>
                  {!suggestion && (
                    <button type="button" onClick={handleAutoDetect} className="dh-sub-btn">
                      <ScanSearch className="h-3 w-3" />
                      <span>{t.autoDetect}</span>
                    </button>
                  )}
                </div>
              )}
              </div>

              {suggestion && !picking && (
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  <button type="button" onClick={acceptSuggestion} className="dh-sub-btn dh-sub-btn-emerald">
                    <span>{t.useSuggestedButton}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => showSuggestion(suggestion.list, (suggestion.index + 1) % suggestion.list.length)}
                    disabled={suggestion.list.length < 2}
                    className="dh-sub-btn"
                  >
                    <span>{t.nextSuggestion}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      clearSuggestion();
                      setStatusMsg({ render: (trans) => trans.initialHUDPrompt, tone: "idle" });
                    }}
                    className="dh-sub-btn"
                  >
                    <span>{t.dismissSuggestion}</span>
                  </button>
                </div>
              )}
            </section>

            {/* Step 2: the time */}
            <section className={`dh-inner-card rounded-2xl p-3 ${hasTarget ? "" : "opacity-60"}`}>
              <div className="mb-2 flex items-center gap-2">
                {step(2)}
                <h3 className="text-[13px] font-semibold text-slate-100">{t.step2Title}</h3>
              </div>
              <div className="grid grid-cols-3 gap-1 rounded-xl bg-black/40 p-1 ring-1 ring-white/5" role="radiogroup" aria-label={t.step2Title}>
                {(
                  [
                    ["midnight", t.slotMidnight],
                    ["custom", t.slotOther],
                    ["quick_10s", t.slotTest],
                  ] as const
                ).map(([slot, label]) => (
                  <button
                    key={slot}
                    type="button"
                    role="radio"
                    aria-checked={targetSlot === slot}
                    onClick={() => handleSelectSlot(slot)}
                    className={`dh-slot-btn ${targetSlot === slot ? "dh-slot-active" : "dh-slot-inactive"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {/* One fixed-height row in every slot: with "Giờ khác" the time itself becomes the input,
                  so choosing it adds no row and nothing below moves. */}
              <div className="mt-2 flex h-[30px] items-center justify-between gap-2 px-0.5 text-[12px]">
                {targetSlot === "custom" ? (
                  <label htmlFor="dh-custom-time" className="flex items-center gap-1.5 text-slate-200">
                    {t.huntAtPrefix}
                    <input
                      id="dh-custom-time"
                      type="text"
                      inputMode="numeric"
                      value={customTime}
                      onChange={(e) => setCustomTime(e.target.value)}
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={() => {
                        const p = parseTimeString(customTime);
                        if (p.valid) setCustomTime(p.formatted);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                      placeholder="20h30"
                      aria-label={t.customTargetPrompt}
                      className={`h-[26px] w-[84px] rounded-lg bg-white/10 px-1.5 text-center font-mono text-[13px] font-bold outline-none ring-1 ${
                        timeInvalid ? "text-rose-300 ring-rose-500/50" : "text-emerald-300 ring-emerald-500/30 focus:ring-emerald-400"
                      }`}
                    />
                  </label>
                ) : (
                  <span className="text-slate-200">{t.huntAt(targetWallClock)}</span>
                )}
                {timeInvalid ? (
                  <span className="truncate font-semibold text-rose-300">{t.invalidTimeShort}</span>
                ) : (
                  <span className="shrink-0 text-slate-400">{t.homeTimeLeft(leftWords)}</span>
                )}
              </div>
              <div className="dh-clock-line mt-1.5 px-0.5 text-[10px]">
                {syncing ? (
                  <span className="text-slate-500">{t.clockChecking}</span>
                ) : calibrated ? (
                  <span className="flex items-center gap-1 text-slate-500">
                    <CircleCheck className="h-3 w-3 text-emerald-500" />
                    {t.clockReady(serverDomain || currentHost)}
                  </span>
                ) : (
                  <>
                    <span className="text-slate-500">{t.clockFailed}</span>
                    <button type="button" onClick={handleRecalibrate} className="font-semibold text-emerald-300 hover:underline">
                      {t.clockRetry}
                    </button>
                  </>
                )}
              </div>
            </section>
          </>
        )}

        {/* Step 3: start (or stop) */}
        <div className="dh-action-group">
          <button
            type="button"
            onClick={() => (isArmed ? disarmHunt() : armHunt())}
            disabled={!isArmed && !canStart}
            className={`dh-arm-btn ${isArmed ? "dh-arm-btn-rose" : canStart ? "dh-arm-btn-emerald" : "dh-arm-btn-disabled"}`}
          >
            {isArmed ? <Square className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
            <span>{isArmed ? t.disarm : t.armSniper}</span>
          </button>
          {/* One fixed-size line for hints and messages: the panel never jumps */}
          <div role="status" aria-live="polite" className="dh-message-slot px-1">
            {showStatus ? (
              <>
                {StatusIcon ? (
                  <StatusIcon className={`h-3.5 w-3.5 shrink-0 ${tone.text}`} />
                ) : (
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
                )}
                <span className={`min-w-0 line-clamp-2 break-words ${tone.text}`}>{statusDisplayText}</span>
              </>
            ) : (
              <span className="text-slate-500">{isArmed ? t.armHint : canStart ? t.armHint : t.noTargetSelected}</span>
            )}
          </div>
          {!isArmed && (
            <>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={handleScheduleFromHUD} disabled={!canStart} className="dh-sub-btn" style={{ flex: 1 }}>
                  <CalendarClock className="h-3 w-3 text-emerald-300" />
                  <span>{t.quickScheduleFromHUD}</span>
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isDailySchedule}
                  onClick={() => setIsDailySchedule(!isDailySchedule)}
                  disabled={!canStart}
                  title={t.dailyScheduleHint}
                  className={`dh-sub-btn dh-sub-btn-auto ${isDailySchedule ? "dh-sub-btn-emerald" : ""}`}
                >
                  <Repeat className="h-3 w-3" />
                  <span>{t.dailyScheduleBadge}</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* More options: everything most people never need. Opens as a floating panel over the card,
            so the panel never changes height and nothing moves under the mouse. */}
        {!isArmed && (
          <div ref={moreRef} className="relative">
            {showMore && (
              <div className="dh-more-popover space-y-1.5 p-3">
                {!pageDisablesReload && (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={preReloadEnabled}
                    onClick={() => setPreReloadEnabled(!preReloadEnabled)}
                    className="flex w-full items-center justify-between gap-2 rounded-xl bg-black/30 px-2.5 py-2 text-left ring-1 ring-white/5"
                  >
                    <span className="min-w-0">
                      <span className="block text-[11px] font-semibold text-slate-200">{t.preReloadToggle}</span>
                      <span className="block text-[10px] leading-snug text-slate-500">
                        {preReloadEnabled ? t.preReloadHint(autoReloadLeadMs) : t.preReloadOffHint}
                      </span>
                    </span>
                    <span className={`relative h-4 w-7 shrink-0 rounded-full transition ${preReloadEnabled ? "bg-emerald-500/80" : "bg-white/15"}`}>
                      <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${preReloadEnabled ? "left-3.5" : "left-0.5"}`} />
                    </span>
                  </button>
                )}
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={handleManualTestClick}
                    disabled={!hasTarget}
                    title={t.testClickTooltip}
                    className={`dh-sub-btn ${testPressedAt ? "dh-sub-btn-emerald" : ""}`}
                  >
                    {testPressedAt ? <Check className="h-3 w-3" /> : <MousePointerClick className="h-3 w-3" />}
                    <span>{testPressedAt ? t.testClickDone : t.testClick}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowMore(false);
                      handleForgetSavedTarget();
                    }}
                    disabled={!hasTarget}
                    className="dh-sub-btn dh-sub-btn-danger"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>{t.forgetTarget}</span>
                  </button>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowMore(!showMore)}
              aria-expanded={showMore}
              className="dh-inner-card flex w-full items-center justify-between rounded-2xl px-3 py-2 text-[12px] font-semibold text-slate-300"
            >
              <span>{t.moreOptions}</span>
              <ChevronDown className={`h-3.5 w-3.5 transition ${showMore ? "" : "rotate-180"}`} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
