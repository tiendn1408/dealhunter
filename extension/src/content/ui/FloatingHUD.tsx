import React, { useState, useEffect, useRef } from "react";
import { timeSyncClient } from "../core/time_sync_client";
import { humanClicker } from "../core/human_clicker";
import { ClickProfileMode } from "../core/human_biometrics";
import { elementResolver, UniversalTargetDescriptor } from "../core/element_resolver";
import { HuntOutcome } from "../core/hunt_engine";
import { huntCoordinator, ARMED_SESSION_KEY } from "../core/hunt_coordinator";
import { targetDiagnostics } from "../core/target_diagnostics";
import { formatVN, nextDropAt, nextExactDropAt, formatCountdown, parseTimeString } from "../../lib/drop_time";
import { storage } from "../../lib/storage";
import { Language, getTranslation } from "../../lib/i18n";
import { MESSAGE_ACTIONS } from "../../lib/constants";
import { ScheduledTask, TargetDiagnosticsSummary } from "../../lib/types";
import { isSamePageUrl } from "../../lib/url";
import { DEALHUNTER_LOGO_DATA_URI } from "./logo_data";
import {
  Crosshair,
  Zap,
  X,
  Minus,
  Maximize2,
  RefreshCw,
  ScanSearch,
  MousePointerClick,
  CircleCheck,
  CircleAlert,
  CircleX,
  Languages,
  GripHorizontal,
  Bookmark,
  BookmarkCheck,
  Trash2,
  CalendarClock,
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

const formatElementIdentifier = (el: HTMLElement, desc?: UniversalTargetDescriptor | null): string => {
  const text = (desc?.initialText || el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim();
  if (text) {
    const clean = text.replace(/\s+/g, " ");
    return clean.length > 25 ? `"${clean.slice(0, 25)}..."` : `"${clean}"`;
  }
  if (desc?.id || el.id) {
    return `#${desc?.id || el.id}`;
  }
  const tag = (desc?.tagName || el.tagName || "button").toLowerCase();
  const classes = Array.from(el.classList).filter((c) => !c.startsWith("dh-"));
  if (classes.length > 0) {
    return `<${tag}.${classes.slice(0, 2).join(".")}>`;
  }
  return `<${tag}>`;
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
  const [serverTimeStr, setServerTimeStr] = useState("--:--:--.--");
  const [offsetMs, setOffsetMs] = useState(0);
  const [errorMs, setErrorMs] = useState(1000);
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

  const [targetSlot, setTargetSlot] = useState<TargetSlot>("quick_10s");
  const [customTime, setCustomTime] = useState("00:00:00");
  const [clickProfile, setClickProfile] = useState<ClickProfileMode>("adaptive");
  const [preReloadEnabled, setPreReloadEnabled] = useState(true);
  const [preReloadLeadMs, setPreReloadLeadMs] = useState(750);
  const armedTargetTimestampRef = useRef<number | null>(null);
  const [countdownStr, setCountdownStr] = useState("--:--:--.-");
  const [targetLabel, setTargetLabel] = useState("--:--:--");
  const [targetWallClock, setTargetWallClock] = useState("--:--:--");
  const [targetSummary, setTargetSummary] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [isTargetSaved, setIsTargetSaved] = useState(false);
  const [diagnostics, setDiagnostics] = useState<TargetDiagnosticsSummary | null>(null);

  // Dragging state
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; startX: number; startY: number } | null>(null);

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
      setOffsetMs(cal.offsetMs);
      setErrorMs(cal.errorMs ?? 1000);
      setCalibrated(cal.calibrated);
      if (cal.serverHost) {
        setServerDomain(cal.serverHost.replace(/^www\./, ""));
      }
    });

    return unsubscribe;
  }, [currentHost]);

  // Helper to restore saved target for a specific URL
  const restoreTargetForUrl = (url: string) => {
    storage.getSavedTargetForUrl(url).then((saved) => {
      if (saved) {
        universalDescRef.current = saved.descriptor;
        savedTargetNameRef.current = saved.name;
        setIsTargetSaved(true);
        setTargetSlot(saved.targetSlot);
        if (saved.customTime) setCustomTime(saved.customTime);

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
        const raw = sessionStorage.getItem("dealhunter_armed_session");
        if (raw) return JSON.parse(raw);
      } catch {}
      return null;
    })();

    if (currentSession && isSamePageUrl(currentSession.url, window.location.href)) {
      if (currentSession.targetSlot) setTargetSlot(currentSession.targetSlot as TargetSlot);
      if (currentSession.customTime) setCustomTime(currentSession.customTime);
      if (currentSession.clickProfileMode) setClickProfile(currentSession.clickProfileMode);
      if (currentSession.dualDefenseReload !== undefined) setPreReloadEnabled(currentSession.dualDefenseReload);
      if (currentSession.preReloadLeadMs) setPreReloadLeadMs(currentSession.preReloadLeadMs);
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
        text: "Đã phục hồi tiến trình sau reload · Đang khóa mục tiêu và đếm ngược...",
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
        if (coordState.statusText === "Disarmed") {
          setStatusMsg({ render: (trans) => trans.disarmedStatus, tone: "idle" });
        } else if (coordState.statusText.startsWith("Armed · ")) {
          const summary = coordState.statusText.slice("Armed · ".length);
          setStatusMsg({
            render: (_trans, currentLang) =>
              currentLang === "vi" ? `Đã đặt mục tiêu · ${summary}` : `Armed · ${summary}`,
            tone: coordState.tone,
          });
        } else if (coordState.statusText.startsWith("Target active · ")) {
          const countNum =
            parseInt(coordState.statusText.replace("Target active · ", "").replace(/[^0-9]/g, ""), 10) || 0;
          setStatusMsg({
            render: (trans, currentLang) =>
              currentLang === "vi"
                ? `Đang săn · ${trans.clicksLabel(countNum)}`
                : `Target active · ${trans.clicksLabel(countNum)}`,
            tone: coordState.tone,
          });
        } else if (coordState.statusText === "Waiting for target button...") {
          setStatusMsg({
            render: (_trans, currentLang) =>
              currentLang === "vi" ? "Đang chờ nút xuất hiện..." : "Waiting for target button...",
            tone: coordState.tone,
          });
        } else if (coordState.statusText.startsWith("Waiting for the drop: ")) {
          const secs = coordState.statusText.replace("Waiting for the drop: ", "");
          setStatusMsg({
            render: (_trans, currentLang) =>
              currentLang === "vi" ? `Đang chờ đến giờ săn: ${secs}` : `Waiting for the drop: ${secs}`,
            tone: coordState.tone,
          });
        } else {
          setStatusMsg({ text: coordState.statusText, tone: coordState.tone });
        }
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

  const handleToggleLang = async () => {
    const nextLang: Language = lang === "en" ? "vi" : "en";
    setLang(nextLang);
    await storage.setLanguage(nextLang);
  };

  // Switch target slot & clear any armed timestamp
  const handleSelectSlot = (slot: TargetSlot) => {
    if (isArmed) return;
    setTargetSlot(slot);
    armedTargetTimestampRef.current = null;
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
      setServerTimeStr(formatVN(now));
      setOffsetMs(timeSyncClient.getOffset());
      setErrorMs(timeSyncClient.getErrorMs());
      setCalibrated(timeSyncClient.getIsCalibrated());
      const host = timeSyncClient.getServerHost();
      if (host) setServerDomain(host.replace(/^www\./, ""));

      const { timestamp, label } = computeTargetTimestamp(now, targetSlot);
      setTargetLabel(label);

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
    targetElementRef.current?.classList.remove("dh-target-highlight");
    el.classList.add("dh-target-highlight");
    targetElementRef.current = el;
    universalDescRef.current = elementResolver.describeUniversal(el);

    const desc = universalDescRef.current;
    setTargetSummary(formatElementIdentifier(el, desc));
    setIsTargetSaved(false);

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

  const handleSaveTarget = async () => {
    if (!universalDescRef.current || typeof window === "undefined") return;
    const desc = universalDescRef.current;
    const name = (targetSummary?.replace(/^\[.*?\]\s*/, "") || desc.initialText || t.targetButtonDefault).trim();
    const existing = await storage.getSavedTargetForUrl(window.location.href);
    await storage.savePageTarget({
      id: existing ? existing.id : `target_${Date.now()}`,
      url: window.location.href,
      origin: window.location.origin,
      name,
      targetSlot,
      customTime: targetSlot === "custom" ? customTime : undefined,
      descriptor: desc,
      dualDefenseReload: true,
      diagnostics: diagnostics || undefined,
      updatedAt: Date.now(),
    });
    setIsTargetSaved(true);
    setStatusMsg({ render: (trans) => trans.targetSavedSuccess, tone: "success" });
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
    const { timestamp, label: timeLabel } = computeTargetTimestamp(now, targetSlot);
    const date = new Date(timestamp + 7 * 3600 * 1000); // VN time
    const h = date.getUTCHours();
    const m = date.getUTCMinutes();
    const s = date.getUTCSeconds();

    if (!isTargetSaved) {
      await handleSaveTarget();
    }

    const saved = await storage.getSavedTargetForUrl(window.location.href);
    const name = (targetSummary?.replace(/^\[.*?\]\s*/, "") || t.targetButtonDefault).trim();

    const task: ScheduledTask = {
      id: Math.random().toString(36).substring(2, 9),
      targetHour: h,
      targetMinute: m,
      targetSecond: s,
      targetUrl: window.location.href,
      label: `${timeLabel} · ${name}`,
      mode: "full_auto",
      savedTargetId: saved?.id,
      descriptor: universalDescRef.current,
      preWarmSeconds: 60,
      dualDefenseReload: true,
      diagnostics: diagnostics || undefined,
      status: "pending",
      createdAt: Date.now(),
    };

    try {
      await chrome.runtime.sendMessage({
        action: MESSAGE_ACTIONS.SCHEDULE_TASK,
        task,
      });
      setStatusMsg({ render: (trans) => trans.quickScheduleSuccess, tone: "success" });
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
    window.addEventListener("dealhunter:activate-pick", onActivatePick);
    return () => window.removeEventListener("dealhunter:activate-pick", onActivatePick);
  }, [minimized]);

  // Synchronize target time from external events (e.g. simulator benchmark tool)
  useEffect(() => {
    const onSetTargetTime = (e: Event) => {
      const customEvent = e as CustomEvent<{ timeStr?: string; timestamp?: number }>;
      if (customEvent.detail?.timeStr && !huntCoordinator.getState().isArmed) {
        setTargetSlot("custom");
        setCustomTime(customEvent.detail.timeStr);
        armedTargetTimestampRef.current = null;
        setStatusMsg({
          text: `Đã đồng bộ giờ G: ${customEvent.detail.timeStr}`,
          tone: "idle",
        });
      }
    };
    window.addEventListener("dealhunter:set-target-time", onSetTargetTime);
    return () => window.removeEventListener("dealhunter:set-target-time", onSetTargetTime);
  }, []);

  // Auto-detect collect buttons
  const handleAutoDetect = () => {
    if (picking) {
      cleanupPickerRef.current?.();
    }
    const buttons = elementResolver.findCollectButtons();
    if (buttons.length > 0) {
      lockTarget(buttons[0]);
      setStatusMsg({
        render: (trans) => trans.foundButtonsCount(buttons.length),
        tone: "idle",
      });
    } else {
      setStatusMsg({ render: (trans) => trans.noButtonFound, tone: "error" });
    }
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

    if (typeof window !== "undefined") {
      const host = window.location.hostname.toLowerCase();
      const path = window.location.pathname.toLowerCase();
      if (host.includes("shopee.") && (path.startsWith("/verify/") || path.startsWith("/buyer/login"))) {
        setStatusMsg({
          text: path.startsWith("/verify/")
            ? "Shopee requires verification. Please verify and sign in first."
            : "Please sign in to Shopee first.",
          tone: "error",
        });
        return;
      }
      if (host.includes("lazada.") && (path.includes("/verification/") || path.includes("/punish") || path.includes("/user/login") || path.includes("/member/login"))) {
        setStatusMsg({
          text: (path.includes("/verification/") || path.includes("/punish"))
            ? "Lazada requires verification. Please verify and sign in first."
            : "Please sign in to Lazada first.",
          tone: "error",
        });
        return;
      }
      if (host.includes("tiki.vn") && (path.includes("/customer/account/login") || path.includes("/account/login"))) {
        setStatusMsg({
          text: "Please sign in to Tiki first.",
          tone: "error",
        });
        return;
      }
      if (host.includes("tiktok.com") && (path.includes("/verify") || path.includes("/login"))) {
        setStatusMsg({
          text: path.includes("/verify")
            ? "TikTok Shop requires verification. Please verify and sign in first."
            : "Please sign in to TikTok Shop first.",
          tone: "error",
        });
        return;
      }
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
      preReloadLeadMs,
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
    if (targetElementRef.current) {
      humanClicker.dispatchClick(targetElementRef.current, { profileMode: clickProfile, approach: true });
      setStatusMsg({ render: (trans) => trans.testClickSuccess, tone: "idle" });
    } else {
      handleAutoDetect();
    }
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

  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className="dh-minimized-pill flex items-center gap-2.5 rounded-full px-4 py-2 text-white shadow-2xl ring-1 ring-white/10 transition hover:ring-emerald-400/50"
      >
        <span className={`h-2 w-2 rounded-full ${isArmed ? "bg-amber-400 animate-pulse" : "bg-emerald-400"}`} />
        <span className="font-mono text-sm font-semibold tabular-nums text-emerald-300">{serverTimeStr}</span>
        {isArmed && <span className="font-mono text-xs tabular-nums text-amber-300">T-{countdownStr}</span>}
        <Maximize2 className="h-3.5 w-3.5 text-slate-400" />
      </button>
    );
  }

  return (
    <div className="dh-floating-card w-[356px] select-none overflow-hidden rounded-3xl text-slate-100 ring-1 ring-white/10">
      {/* Draggable Header */}
      <div
        onMouseDown={handleHeaderMouseDown}
        className="dh-header flex cursor-grab items-center justify-between gap-2 px-3.5 py-2.5 active:cursor-grabbing select-none"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <img
            src={DEALHUNTER_LOGO_DATA_URI}
            alt="DealHunter"
            className="h-8 w-8 shrink-0 rounded-xl object-cover shadow-lg shadow-emerald-900/50"
          />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="flex items-center gap-1.5 text-[13px] font-bold tracking-tight text-white">
              <span className="shrink-0">DealHunter</span>
              <span title={t.dragHudTooltip} className="cursor-grab">
                <GripHorizontal className="h-3 w-3 shrink-0 text-slate-500 opacity-60" />
              </span>
            </div>
            <div className="truncate text-[10px] font-medium text-slate-400">
              {typeof t.hudSubtitle === "function" ? t.hudSubtitle(currentHost) : t.hudSubtitle}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={handleToggleLang}
            className="dh-header-btn dh-header-btn-lang"
            title={t.toggleLanguageTooltip(lang === "en" ? "vi" : "en")}
          >
            <Languages className="h-3.5 w-3.5 shrink-0" />
            <span>{lang.toUpperCase()}</span>
          </button>
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

      <div className="space-y-2.5 px-3.5 pb-3.5 pt-2">
        {/* Card 1: Universal Server clock */}
        <div className="dh-inner-card rounded-2xl p-3">
          <div className="dh-card-header dh-card-header-clock flex items-center justify-between">
            <div className="flex items-center gap-1.5" title={serverDomain ? `${t.offsetVsDomain(serverDomain)} (${serverDomain})` : t.localDeviceTime}>
              <span className={`h-1.5 w-1.5 rounded-full ${calibrated ? "bg-emerald-400 shadow-sm shadow-emerald-400/50" : "bg-amber-400 animate-pulse"}`} />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {calibrated ? (t.atomicClockLabel || "NTP Server Time") : t.localDeviceTime}
              </span>
            </div>
            <button
              type="button"
              onClick={handleRecalibrate}
              disabled={syncing}
              className={`dh-recalibrate-btn flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
                calibrated
                  ? "dh-calibrated ring-1 ring-emerald-500/30"
                  : "dh-uncalibrated ring-1 ring-amber-500/30"
              }`}
              title={t.resyncClockTooltip}
            >
              <RefreshCw className={`h-2.5 w-2.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing
                ? t.syncingClock
                : calibrated
                ? `${offsetMs >= 0 ? "+" : ""}${offsetMs} ms ±${errorMs}`
                : t.notSyncedRetry}
            </button>
          </div>
          <div className="my-1.5 text-center font-mono text-[28px] font-bold tracking-tight text-emerald-400 tabular-nums">
            {serverTimeStr}
          </div>
        </div>

        {/* Card 2: Timing & Countdown */}
        <div className="dh-inner-card rounded-2xl p-3">
          {/* Card Header matching Card 1 and Card 3 */}
          <div className="dh-card-header flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {t.timingAndCountdown || "Timing & Countdown"}
            </span>
            {isArmed && (
              <span className="dh-card-badge flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-amber-500/30">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
                <span>{t.armedCountdown}</span>
              </span>
            )}
          </div>

          {/* Slot selector grid */}
          <div className="grid grid-cols-5 gap-1 rounded-xl bg-black/40 p-1 ring-1 ring-white/5">
            {(
              [
                ["quick_10s", "+10s", t.quickTest10s || "+10s"],
                ["quick_30s", "+30s", t.quickTest30s || "+30s"],
                ["00:00", "00:00", "00:00:00"],
                ["next_minute", t.slotNextMinute, t.nextMinute || "Next min"],
                ["custom", t.slotCustom, t.customTime || "Custom"],
              ] as const
            ).map(([slotKey, shortLabel, fullTitle]) => {
              const actualSlot: TargetSlot =
                slotKey === "00:00" ? "midnight" : (slotKey as TargetSlot);
              const isActive = targetSlot === actualSlot;
              return (
                <button
                  key={slotKey}
                  type="button"
                  disabled={isArmed}
                  onClick={() => handleSelectSlot(actualSlot)}
                  title={fullTitle}
                  className={`dh-slot-btn ${
                    isActive
                      ? "dh-slot-active"
                      : "dh-slot-inactive"
                  } disabled:cursor-not-allowed`}
                >
                  {shortLabel}
                </button>
              );
            })}
          </div>

          {/* Custom Time input field */}
          {targetSlot === "custom" && (
            <div className="mt-2 space-y-1">
              <div className="flex items-center justify-between gap-2 rounded-xl bg-black/40 px-2.5 py-1.5 ring-1 ring-white/10">
                <span className="text-[10px] font-medium text-slate-400">{t.customTargetPrompt || "Target time:"}</span>
                <input
                  type="text"
                  disabled={isArmed}
                  value={customTime}
                  onChange={(e) => setCustomTime(e.target.value)}
                  placeholder="HH:mm:ss"
                  className={`w-24 rounded-lg bg-white/10 px-2 py-0.5 text-center font-mono text-xs font-bold outline-none ring-1 disabled:opacity-50 ${
                    !parseTimeString(customTime).valid
                      ? "text-rose-300 ring-rose-500/50 focus:ring-rose-400"
                      : "text-emerald-300 ring-emerald-500/30 focus:ring-emerald-400"
                  }`}
                />
              </div>
              {!parseTimeString(customTime).valid && (
                <span className="block text-center text-[9px] font-semibold text-rose-400">
                  {t.invalidTimeFormat}
                </span>
              )}
            </div>
          )}

          {/* Balanced 2-Column Info Display (Equal 2 lines on each side) */}
          <div className="mt-2.5 grid grid-cols-2 gap-2 rounded-xl bg-black/40 p-2.5 ring-1 ring-white/5">
            <div className="flex flex-col justify-center border-r border-white/10 pr-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                {t.dropAtLabel || "Target time"}
              </span>
              <div className="mt-0.5 font-mono text-base font-bold text-slate-100 tabular-nums">
                {targetWallClock}
              </div>
            </div>
            <div className="flex flex-col justify-center pl-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                {t.countdownLabel || "Countdown"}
              </span>
              <div className={`mt-0.5 font-mono text-base font-bold tabular-nums ${isArmed ? "text-amber-300 animate-pulse" : "text-emerald-400"}`}>
                {countdownStr}
              </div>
            </div>
          </div>
        </div>

        {/* Card 3: Universal Target locking */}
        <div className="dh-inner-card rounded-2xl p-3">
          <div className="dh-card-header flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t.targetVoucher}</span>
            {isTargetSaved && (
              <span className="dh-card-badge flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                <BookmarkCheck className="h-2.5 w-2.5" />
                {t.savedTarget}
              </span>
            )}
          </div>
          {targetSummary && (
            <div className="mb-2.5 flex items-center justify-between gap-2 rounded-xl bg-emerald-500/10 px-2.5 py-1.5 ring-1 ring-emerald-500/20">
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" />
                <span className="truncate font-mono text-xs font-semibold text-emerald-300" title={targetSummary}>
                  {targetSummary}
                </span>
              </div>
              <button
                type="button"
                onClick={handleForgetSavedTarget}
                disabled={isArmed}
                className="shrink-0 rounded p-0.5 text-slate-400 transition hover:bg-white/10 hover:text-rose-400 disabled:opacity-40"
                title={t.forgetTarget}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleSelectTarget}
              disabled={isArmed}
              className={`dh-action-btn flex items-center justify-center gap-1.5 rounded-xl text-[11px] font-semibold transition disabled:opacity-40 ${
                picking ? "dh-action-btn-cancelling" : ""
              }`}
              title={picking ? t.cancelPickTooltip : targetSummary ? t.changeButton : t.pickButton}
            >
              {picking ? (
                <>
                  <X className="h-3.5 w-3.5 text-rose-400 animate-pulse stroke-[2]" />
                  <span>{t.cancelPick}</span>
                </>
              ) : (
                <>
                  <Crosshair className="h-3.5 w-3.5 text-emerald-300 stroke-[1.75]" />
                  <span>{targetSummary ? t.changeButton : t.pickButton}</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleAutoDetect}
              disabled={isArmed}
              className="dh-action-btn flex items-center justify-center gap-1.5 rounded-xl text-[11px] font-semibold transition disabled:opacity-40"
            >
              <ScanSearch className="h-3.5 w-3.5 text-emerald-300 stroke-[1.75]" />
              <span>{t.autoDetect}</span>
            </button>
          </div>
          {targetSummary && (
            <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-white/5 pt-2">
              {isTargetSaved ? (
                <button
                  type="button"
                  onClick={handleForgetSavedTarget}
                  disabled={isArmed}
                  className="dh-sub-btn dh-sub-btn-danger flex items-center justify-center gap-1.5 rounded-lg text-[10px] font-semibold transition disabled:opacity-50"
                  title={t.forgetTarget}
                >
                  <Trash2 className="h-2.5 w-2.5" />
                  <span>{t.forgetTarget}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSaveTarget}
                  disabled={isArmed || !universalDescRef.current}
                  className="dh-sub-btn dh-sub-btn-emerald flex items-center justify-center gap-1.5 rounded-lg text-[10px] font-semibold transition disabled:opacity-50"
                  title={t.saveTarget}
                >
                  <Bookmark className="h-2.5 w-2.5" />
                  <span>{t.saveTarget}</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleScheduleFromHUD}
                disabled={isArmed || !universalDescRef.current}
                className="dh-sub-btn flex items-center justify-center gap-1.5 rounded-lg text-[10px] font-semibold transition disabled:opacity-50"
                title={t.quickScheduleFromHUD}
              >
                <CalendarClock className="h-3 w-3 text-emerald-300" />
                <span>{t.quickScheduleFromHUD}</span>
              </button>
            </div>
          )}
        </div>

        {/* Action Group: Primary CTA & Secondary Test Click */}
        <div className="dh-action-group">
          <button
            type="button"
            onClick={() => (isArmed ? disarmHunt() : armHunt())}
            disabled={!isArmed && (!hasTarget || (targetSlot === "custom" && !parseTimeString(customTime).valid))}
            className={`dh-arm-btn flex w-full items-center justify-center gap-2 rounded-xl text-xs font-bold uppercase tracking-wider text-white shadow-lg transition ${
              isArmed
                ? "dh-arm-btn-rose bg-gradient-to-r from-rose-500 to-rose-600 shadow-rose-950/50 hover:from-rose-400 hover:to-rose-500"
                : !hasTarget || (targetSlot === "custom" && !parseTimeString(customTime).valid)
                ? "opacity-40 cursor-not-allowed bg-slate-700 shadow-none hover:bg-slate-700"
                : "dh-arm-btn-emerald bg-gradient-to-r from-emerald-500 to-teal-500 shadow-emerald-950/50 hover:from-emerald-400 hover:to-teal-400"
            }`}
          >
            <Zap className="h-4 w-4" />
            <span>{isArmed ? t.disarm : t.armSniper}</span>
          </button>

          <button
            type="button"
            onClick={handleManualTestClick}
            disabled={isArmed}
            className="dh-test-click-btn flex w-full items-center justify-center gap-1.5 rounded-xl text-[11px] font-medium transition disabled:opacity-40"
            title={t.testClickTooltip}
          >
            <MousePointerClick className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <span>{t.testClick}</span>
          </button>
        </div>

        {/* Status Bar */}
        <div
          role="status"
          aria-live="polite"
          className={`dh-status-bar flex h-[48px] min-h-[48px] max-h-[48px] items-center gap-2 rounded-xl bg-black/40 px-3 py-1.5 ring-1 overflow-hidden ${tone.ring}`}
        >
          {StatusIcon ? (
            <StatusIcon className={`h-3.5 w-3.5 shrink-0 ${tone.text}`} />
          ) : (
            <span className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
          )}
          <span className={`flex-1 min-w-0 text-[11px] leading-snug line-clamp-2 break-words ${tone.text}`}>{statusDisplayText}</span>
        </div>
      </div>
    </div>
  );
};

