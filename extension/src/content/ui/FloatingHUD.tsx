import React, { useState, useEffect, useRef } from "react";
import { timeSyncClient } from "../core/time_sync_client";
import { humanClicker } from "../core/human_clicker";
import { ClickProfileMode } from "../core/human_biometrics";
import { elementResolver, UniversalTargetDescriptor } from "../core/element_resolver";
import { HuntOutcome } from "../core/hunt_engine";
import { huntCoordinator, ARMED_SESSION_KEY } from "../core/hunt_coordinator";
import { targetDiagnostics } from "../core/target_diagnostics";
import { formatVN, nextDropAt, nextExactDropAt, formatCountdown } from "../../lib/drop_time";
import { storage } from "../../lib/storage";
import { Language, getTranslation } from "../../lib/i18n";
import { MESSAGE_ACTIONS } from "../../lib/constants";
import { ScheduledTask, TargetDiagnosticsSummary } from "../../lib/types";
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
  Timer,
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
  firing: { dot: "bg-orange-400 animate-ping", text: "text-orange-200", ring: "ring-orange-500/40" },
  success: { dot: "bg-emerald-400", text: "text-emerald-200", ring: "ring-emerald-500/40" },
  warning: { dot: "bg-amber-400", text: "text-amber-200", ring: "ring-amber-500/40" },
  error: { dot: "bg-rose-400", text: "text-rose-200", ring: "ring-rose-500/40" },
};

export const FloatingHUD: React.FC<FloatingHUDProps> = ({ onClose, hostElement, autoPick }) => {
  const [lang, setLang] = useState<Language>("en");
  const [minimized, setMinimized] = useState(false);
  const [isArmed, setIsArmed] = useState(false);
  const [serverTimeStr, setServerTimeStr] = useState("--:--:--.---");
  const [offsetMs, setOffsetMs] = useState(0);
  const [errorMs, setErrorMs] = useState(1000);
  const [calibrated, setCalibrated] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone: Tone }>({
    text: "",
    tone: "idle",
  });

  const [targetSlot, setTargetSlot] = useState<TargetSlot>("quick_10s");
  const [customTime, setCustomTime] = useState("00:00:00");
  const [clickProfile, setClickProfile] = useState<ClickProfileMode>("adaptive");
  const armedTargetTimestampRef = useRef<number | null>(null);
  const [countdownStr, setCountdownStr] = useState("--:--:--.-");
  const [targetLabel, setTargetLabel] = useState("--:--:--");
  const [targetSummary, setTargetSummary] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [isTargetSaved, setIsTargetSaved] = useState(false);
  const [diagnostics, setDiagnostics] = useState<TargetDiagnosticsSummary | null>(null);
  const [analyzingTarget, setAnalyzingTarget] = useState(false);

  // Dragging state
  const [hudPos, setHudPos] = useState<{ x: number; y: number } | null>(null);
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

  // Restore saved target for this page URL on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    storage.getSavedTargetForUrl(window.location.href).then((saved) => {
      if (saved) {
        universalDescRef.current = saved.descriptor;
        savedTargetNameRef.current = saved.name;
        setIsTargetSaved(true);
        setTargetSlot(saved.targetSlot);
        if (saved.customTime) setCustomTime(saved.customTime);

        // Try relocating on the current DOM
        const el = elementResolver.relocateUniversal(saved.descriptor);
        if (el) {
          targetElementRef.current = el;
          el.classList.add("dh-target-highlight");
          setTargetSummary(saved.name);
        } else {
          // Target is saved, but currently in standby / completed state
          setTargetSummary(`${t.standbyPrefix}${saved.name}`);
        }
        setStatus({ text: getTranslation(lang).savedTargetRestored, tone: "idle" });
      }
    });
  }, [lang]);

  // Load saved click profile from settings on mount
  useEffect(() => {
    storage.getSettings().then((s) => {
      if (s.clickProfileMode) setClickProfile(s.clickProfileMode);
    });
  }, []);

  // Continuous target locator: observes DOM mutations & polls to ensure target highlight is NEVER lost on reload/SPAs
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
        const name = (savedTargetNameRef.current || elementResolver.text(el) || t.targetButtonDefault).trim();
        setTargetSummary(name);
      }
    };

    attemptRelocate();
    const interval = setInterval(attemptRelocate, 350);

    let observer: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined" && document.body) {
      observer = new MutationObserver(() => attemptRelocate());
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      clearInterval(interval);
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
      }
      if (coordState.outcome) {
        const view = getResultView(coordState.outcome.result);
        setStatus({ text: `${view.text} · ${coordState.outcome.clicks} clicks`, tone: view.tone });
      } else if (coordState.statusText) {
        if (coordState.statusText === "Disarmed") {
          setStatus({ text: t.disarmedStatus, tone: "idle" });
        } else {
          setStatus({ text: coordState.statusText, tone: coordState.tone });
        }
      }
    });
  }, [t.disarmedStatus, t.outcome]);

  // Initialize language from settings & listen for changes
  useEffect(() => {
    storage.getLanguage().then((storedLang) => {
      setLang(storedLang);
      setStatus({ text: getTranslation(storedLang).initialHUDPrompt, tone: "idle" });
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
      const parts = customTime.split(":").map((p) => parseInt(p.trim(), 10));
      const h = Number.isFinite(parts[0]) && parts[0] >= 0 && parts[0] < 24 ? parts[0] : 0;
      const m = Number.isFinite(parts[1]) && parts[1] >= 0 && parts[1] < 60 ? parts[1] : 0;
      const s = Number.isFinite(parts[2]) && parts[2] >= 0 && parts[2] < 60 ? parts[2] : 0;
      const at = nextExactDropAt(h, m, s, now);
      return { timestamp: at, label: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` };
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

      let diff = 0;
      if (!isArmed && targetSlot === "quick_10s") {
        diff = 10_000;
      } else if (!isArmed && targetSlot === "quick_30s") {
        diff = 30_000;
      } else {
        diff = Math.max(0, timestamp - now);
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
    };
  }, []);

  const isOwnElement = (el: HTMLElement | null) => !!hostElement && (hostElement === el || hostElement.contains(el));
  const isOwnEvent = (e: Event) => !!hostElement && e.composedPath().includes(hostElement);

  const lockTarget = (el: HTMLElement) => {
    targetElementRef.current?.classList.remove("dh-target-highlight");
    el.classList.add("dh-target-highlight");
    targetElementRef.current = el;
    universalDescRef.current = elementResolver.describeUniversal(el);

    const desc = universalDescRef.current;
    setTargetSummary(desc.initialText || desc.id || (el.innerText || t.lockedButtonDefault).trim().slice(0, 40));
    setIsTargetSaved(false);

    // Fast synchronous inspection
    const instant = targetDiagnostics.inspect(el);
    setDiagnostics(instant);

    // Comprehensive async analysis (samples countdown ticking)
    setAnalyzingTarget(true);
    targetDiagnostics.analyze(el).then((diag) => {
      setDiagnostics(diag);
      setAnalyzingTarget(false);
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
    setStatus({ text: t.targetSavedSuccess, tone: "success" });
  };

  const handleForgetSavedTarget = async () => {
    if (typeof window === "undefined") return;
    const existing = await storage.getSavedTargetForUrl(window.location.href);
    if (existing) {
      await storage.removePageTarget(existing.id);
      setIsTargetSaved(false);
      setStatus({ text: t.targetForgotten, tone: "idle" });
    }
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
      setStatus({ text: t.quickScheduleSuccess, tone: "success" });
    } catch (err) {
      console.warn("Schedule from HUD failed:", err);
    }
  };

  const cleanupPickerRef = useRef<(() => void) | null>(null);

  // Pick target with pointerdown and visual hover overlay
  const handleSelectTarget = () => {
    if (picking) {
      cleanupPickerRef.current?.();
      setStatus({ text: t.initialHUDPrompt, tone: "idle" });
      return;
    }

    setPicking(true);
    document.body.classList.add("dh-picking-active");
    setStatus({
      text: t.pickInstruction,
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
      const badgeTop = rect.top < 30 ? "bottom: -26px;" : "top: -26px;";

      overlayEl.innerHTML = `<div id="dh-picker-badge" style="${badgeTop}">${t.pickerBadgePrefix} · ${tag} "${displayLabel}"</div>`;

      setStatus({
        text: t.targetingBadge(tag, displayLabel),
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
        setStatus({ text: t.initialHUDPrompt, tone: "idle" });
        return;
      }

      const el = elementResolver.normalizeTarget(rawTarget);
      if (!el || isOwnElement(el) || el === document.body || el === document.documentElement) {
        cleanup();
        setStatus({ text: t.initialHUDPrompt, tone: "idle" });
        return;
      }

      lockTarget(el);
      cleanup();
      setStatus({ text: t.targetLockedInstruction, tone: "idle" });

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
        setStatus({ text: t.initialHUDPrompt, tone: "idle" });
      }
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      cleanup();
      setStatus({ text: t.initialHUDPrompt, tone: "idle" });
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("pointerdown", onPick, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("contextmenu", onContextMenu);
  };

  useEffect(() => {
    if (autoPick) {
      const timer = setTimeout(() => {
        handleSelectTarget();
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [autoPick]);

  // Auto-detect collect buttons
  const handleAutoDetect = () => {
    if (picking) {
      cleanupPickerRef.current?.();
    }
    const buttons = elementResolver.findCollectButtons();
    if (buttons.length > 0) {
      lockTarget(buttons[0]);
      setStatus({
        text: t.foundButtonsCount(buttons.length),
        tone: "idle",
      });
    } else {
      setStatus({ text: t.noButtonFound, tone: "error" });
    }
  };
  // Arm Sniper: delegates to unified HuntCoordinator (single engine pipeline)
  const armHunt = (overrideTimestamp?: number) => {
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
    setStatus({ text: t.armedWaitingDrop, tone: "armed" });

    huntCoordinator.arm({
      targetTimestamp: timestamp,
      targetElement: targetElementRef.current,
      descriptor: universalDescRef.current,
      targetSlot,
      customTime: targetSlot === "custom" ? customTime : undefined,
      label: targetSummary || undefined,
      clickProfileMode: clickProfile,
    });
  };

  const disarmHunt = () => {
    huntCoordinator.disarm();
    armedTargetTimestampRef.current = null;
    setIsArmed(false);
    setStatus({ text: t.disarmedStatus, tone: "idle" });
  };

  const handleManualTestClick = () => {
    if (targetElementRef.current) {
      humanClicker.dispatchClick(targetElementRef.current, { profileMode: clickProfile, approach: true });
      setStatus({ text: t.testClickSuccess, tone: "idle" });
    } else {
      handleAutoDetect();
    }
  };

  const handleRecalibrate = async () => {
    setSyncing(true);
    setStatus({ text: t.syncingClock, tone: "idle" });
    await timeSyncClient.calibrate();
    setSyncing(false);
    setStatus({
      text: timeSyncClient.getIsCalibrated() ? t.syncedClockSuccess : t.syncedClockFailed,
      tone: timeSyncClient.getIsCalibrated() ? "success" : "error",
    });
  };

  // Draggable header handler
  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button") || (e.target as HTMLElement).closest("input")) return;
    e.preventDefault();

    const hudCard = (e.currentTarget as HTMLElement).closest(".dh-floating-card") as HTMLElement | null;
    const rect = hudCard?.getBoundingClientRect() || (hostElement?.getBoundingClientRect());
    if (!rect) return;

    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: rect.left,
      startY: rect.top,
    };

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = ev.clientX - dragStartRef.current.mouseX;
      const dy = ev.clientY - dragStartRef.current.mouseY;
      const newX = Math.max(12, Math.min(window.innerWidth - 352, dragStartRef.current.startX + dx));
      const newY = Math.max(12, Math.min(window.innerHeight - 100, dragStartRef.current.startY + dy));
      setHudPos({ x: newX, y: newY });
    };

    const onMouseUp = () => {
      dragStartRef.current = null;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const tone = TONE_STYLES[status.tone];
  const StatusIcon =
    status.tone === "success" ? CircleCheck : status.tone === "error" ? CircleX : status.tone === "warning" ? CircleAlert : null;

  const clockTitle = timeSyncClient.getIsCalibrated()
    ? (t.serverClockTitle ? t.serverClockTitle(serverDomain) : `${serverDomain} time`)
    : t.localDeviceTime;

  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className="dh-minimized-pill flex items-center gap-2.5 rounded-full px-4 py-2 text-white shadow-2xl ring-1 ring-white/10 transition hover:ring-emerald-400/50"
        style={hudPos ? { position: "fixed", left: `${hudPos.x}px`, top: `${hudPos.y}px` } : { position: "fixed", right: "24px", bottom: "24px" }}
      >
        <span className={`h-2 w-2 rounded-full ${isArmed ? "bg-amber-400 animate-pulse" : "bg-emerald-400"}`} />
        <span className="font-mono text-sm font-semibold tabular-nums text-emerald-300">{serverTimeStr}</span>
        {isArmed && <span className="font-mono text-xs tabular-nums text-amber-300">T-{countdownStr}</span>}
        <Maximize2 className="h-3.5 w-3.5 text-slate-400" />
      </button>
    );
  }

  return (
    <div
      className="dh-floating-card w-[356px] select-none overflow-hidden rounded-3xl text-slate-100 ring-1 ring-white/10"
      style={hudPos ? { position: "fixed", left: `${hudPos.x}px`, top: `${hudPos.y}px`, bottom: "auto", right: "auto" } : { position: "fixed", right: "24px", bottom: "24px" }}
    >
      {/* Draggable Header */}
      <div
        onMouseDown={handleHeaderMouseDown}
        className="dh-header flex cursor-grab items-center justify-between px-4 py-3 active:cursor-grabbing"
        title={t.dragHudTooltip}
      >
        <div className="flex items-center gap-2.5">
          {typeof chrome !== "undefined" && chrome.runtime?.getURL ? (
            <img
              src={chrome.runtime.getURL("icons/icon48.png")}
              alt="DealHunter"
              className="h-8 w-8 rounded-xl object-cover shadow-lg shadow-emerald-900/50"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 text-[11px] font-black text-white shadow-lg shadow-emerald-900/50">
              DH
            </div>
          )}
          <div className="leading-tight">
            <div className="flex items-center gap-1.5 text-[13px] font-bold tracking-tight">
              <span>DealHunter</span>
              <GripHorizontal className="h-3 w-3 text-slate-500 opacity-60" />
            </div>
            <div className="truncate text-[10px] font-medium text-slate-400">
              {typeof t.hudSubtitle === "function" ? t.hudSubtitle(currentHost) : t.hudSubtitle}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleToggleLang}
            className="dh-icon-btn dh-lang-btn flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold text-emerald-300 ring-1 ring-white/10 transition hover:bg-white/10"
            title={t.toggleLanguageTooltip(lang === "en" ? "vi" : "en")}
          >
            <Languages className="h-3 w-3" />
            <span>{lang.toUpperCase()}</span>
          </button>
          <button
            type="button"
            onClick={() => setMinimized(true)}
            className="dh-icon-btn rounded-lg p-1.5 text-slate-400 transition hover:bg-white/5 hover:text-slate-100"
            title="Minimize"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="dh-icon-btn rounded-lg p-1.5 text-slate-400 transition hover:bg-white/5 hover:text-slate-100"
              title="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3 px-4 pb-4 pt-1">
        {/* Universal Server clock */}
        <div className="dh-inner-card rounded-2xl p-3">
          <div className="flex items-center justify-between">
            <span className="truncate pr-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {clockTitle}
            </span>
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
          <div className="mt-1 text-center font-mono text-[28px] font-bold leading-none tabular-nums tracking-tight text-emerald-300">
            {serverTimeStr}
          </div>
        </div>

        {/* Drop target with Quick Testing and Custom Time */}
        <div className="dh-inner-card rounded-2xl p-3">
          {/* Slot selector grid */}
          <div className="grid grid-cols-5 gap-1 rounded-xl bg-black/40 p-1 ring-1 ring-white/5">
            {(
              [
                ["quick_10s", "+10s", t.quickTest10s || "+10s"],
                ["quick_30s", "+30s", t.quickTest30s || "+30s"],
                ["00:00", "00:00", "00:00:00"],
                ["next_minute", lang === "vi" ? "+1p" : "+1m", t.nextMinute || "Next min"],
                ["custom", lang === "vi" ? "Tự chọn" : "Custom", t.customTime || "Custom"],
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
                  className={`dh-slot-btn rounded-lg py-1 px-0.5 text-center font-mono text-[10px] font-semibold transition ${
                    isActive
                      ? "dh-slot-active bg-emerald-500 text-white shadow"
                      : "dh-slot-inactive text-slate-400 hover:text-slate-200"
                  } disabled:cursor-not-allowed`}
                >
                  {shortLabel}
                </button>
              );
            })}
          </div>

          {/* Custom Time input field */}
          {targetSlot === "custom" && (
            <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl bg-black/40 px-2.5 py-1.5 ring-1 ring-white/10">
              <span className="text-[10px] font-medium text-slate-400">{t.customTargetPrompt || "Target time:"}</span>
              <input
                type="text"
                disabled={isArmed}
                value={customTime}
                onChange={(e) => setCustomTime(e.target.value)}
                placeholder="HH:mm:ss"
                className="w-24 rounded-lg bg-white/10 px-2 py-0.5 text-center font-mono text-xs font-bold text-emerald-300 outline-none ring-1 ring-emerald-500/30 focus:ring-emerald-400 disabled:opacity-50"
              />
            </div>
          )}

          {/* Target & Countdown Box */}
          <div className="mt-2.5 flex items-center justify-between rounded-xl bg-black/20 px-3 py-2 ring-1 ring-white/5">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <Timer className={`h-3.5 w-3.5 ${isArmed ? "text-amber-400 animate-spin" : "text-emerald-400"}`} />
                <span>{t.dropIn}</span>
              </div>
              <div className="font-mono text-[11px] text-slate-400">
                <span className="text-slate-500">{t.targetPrefix}</span>
                <span className="font-semibold text-slate-300">{targetLabel}</span>
              </div>
            </div>
            <div className="text-right">
              <div
                className={`font-mono text-xl font-bold leading-none tabular-nums ${
                  isArmed ? "text-amber-300 animate-pulse" : "text-slate-100"
                }`}
              >
                {countdownStr}
              </div>
              <div className="mt-1 text-[9px] font-medium uppercase tracking-wider text-slate-500">
                {isArmed ? t.armedCountdown : t.standbyReady}
              </div>
            </div>
          </div>
        </div>

        {/* Universal Target locking */}
        <div className="dh-inner-card rounded-2xl p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t.targetVoucher}</span>
            <div className="flex items-center gap-1.5">
              {isTargetSaved ? (
                <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                  <BookmarkCheck className="h-2.5 w-2.5" />
                  {t.savedTarget}
                </span>
              ) : targetSummary ? (
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                  {t.locked}
                </span>
              ) : (
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-slate-400 ring-1 ring-white/10">
                  {t.opensAtDrop}
                </span>
              )}
            </div>
          </div>
          <p className="mb-2.5 truncate font-mono text-[11px] text-slate-300" title={targetSummary ?? undefined}>
            {targetSummary ? `[Locked] ${targetSummary}` : t.notPickedText}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleSelectTarget}
              disabled={isArmed}
              className={`dh-action-btn flex items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-semibold transition disabled:opacity-40 ${
                picking ? "dh-action-btn-cancelling" : ""
              }`}
              title={picking ? t.cancelPickTooltip : t.pickButton}
            >
              {picking ? (
                <>
                  <X className="h-3.5 w-3.5 text-rose-400 animate-pulse" />
                  <span>{t.cancelPick}</span>
                </>
              ) : (
                <>
                  <Crosshair className="h-3.5 w-3.5 text-emerald-300" />
                  <span>{t.pickButton}</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleAutoDetect}
              disabled={isArmed}
              className="dh-action-btn flex items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-semibold transition disabled:opacity-40"
            >
              <ScanSearch className="h-3.5 w-3.5 text-emerald-300" />
              {t.autoDetect}
            </button>
          </div>
          {targetSummary && (
            <div className="mt-2.5 flex items-center justify-between border-t border-white/5 pt-2">
              <div className="flex items-center gap-1.5">
                {isTargetSaved ? (
                  <button
                    type="button"
                    onClick={handleForgetSavedTarget}
                    disabled={isArmed}
                    className="dh-sub-btn dh-sub-btn-danger flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium disabled:opacity-40"
                    title={t.forgetTarget}
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                    {t.forgetTarget}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSaveTarget}
                    disabled={isArmed || !universalDescRef.current}
                    className="dh-sub-btn dh-sub-btn-emerald flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-semibold disabled:opacity-40"
                    title={t.saveTarget}
                  >
                    <Bookmark className="h-2.5 w-2.5" />
                    {t.saveTarget}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={handleScheduleFromHUD}
                disabled={isArmed || !universalDescRef.current}
                className="dh-sub-btn flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-semibold disabled:opacity-40"
                title={t.quickScheduleFromHUD}
              >
                <CalendarClock className="h-3 w-3 text-emerald-300" />
                {t.quickScheduleFromHUD}
              </button>
            </div>
          )}
        </div>

        {/* Arm / Disarm */}
        <button
          type="button"
          onClick={() => (isArmed ? disarmHunt() : armHunt())}
          className={`flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold text-white shadow-lg transition ${
            isArmed
              ? "dh-arm-btn-rose bg-gradient-to-r from-rose-500 to-rose-600 shadow-rose-950/50 hover:from-rose-400 hover:to-rose-500"
              : "dh-arm-btn-emerald bg-gradient-to-r from-emerald-500 to-teal-500 shadow-emerald-950/50 hover:from-emerald-400 hover:to-teal-400"
          }`}
        >
          <Zap className="h-4 w-4" />
          {isArmed ? t.disarm : t.armSniper}
        </button>

        {/* Manual Test Click */}
        <button
          type="button"
          onClick={handleManualTestClick}
          disabled={isArmed}
          className="dh-test-click-btn flex w-full items-center justify-center gap-1.5 text-[11px] font-medium text-slate-400 transition hover:text-slate-200 disabled:opacity-40"
          title={t.testClickTooltip}
        >
          <MousePointerClick className="h-3.5 w-3.5" />
          {t.testClick}
        </button>

        {/* Status */}
        <div className={`h-[44px] min-h-[44px] max-h-[44px] shrink-0 flex items-center gap-2 rounded-xl bg-black/30 px-3 py-1.5 ring-1 ${tone.ring}`}>
          {StatusIcon ? (
            <StatusIcon className={`h-3.5 w-3.5 shrink-0 ${tone.text}`} />
          ) : (
            <span className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
          )}
          <span className={`text-[11px] leading-snug line-clamp-2 ${tone.text}`}>{status.text}</span>
        </div>
      </div>
    </div>
  );
};

