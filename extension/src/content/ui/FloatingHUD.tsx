import React, { useState, useEffect, useRef } from "react";
import { timeSyncClient } from "../core/time_sync_client";
import { humanClicker } from "../core/human_clicker";
import { elementResolver } from "../core/element_resolver";
import { startHunt, HuntOutcome } from "../core/hunt_engine";
import { formatVN, nextFlashDrop } from "../../lib/drop_time";
import { SHOPEE_FLASH_HOURS } from "../../lib/constants";
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
} from "lucide-react";

interface FloatingHUDProps {
  onClose?: () => void;
  /** The HUD's host element; clicks on the HUD itself are ignored while picking a target. */
  hostElement?: HTMLElement;
}

type Tone = "idle" | "armed" | "firing" | "success" | "warning" | "error";

const RESULT_VIEW: Record<HuntOutcome["result"], { text: string; tone: Tone }> = {
  saved: { text: "Voucher saved — confirmed by the page", tone: "success" },
  exhausted: { text: "Voucher fully claimed (out of stock)", tone: "warning" },
  not_found: { text: "No matching voucher button appeared", tone: "error" },
  timeout: { text: "Clicked, but the page never confirmed it — check your voucher wallet", tone: "warning" },
  cancelled: { text: "Hunt cancelled", tone: "idle" },
};

const TONE_STYLES: Record<Tone, { dot: string; text: string; ring: string }> = {
  idle: { dot: "bg-slate-500", text: "text-slate-300", ring: "ring-slate-700/60" },
  armed: { dot: "bg-amber-400 animate-pulse", text: "text-amber-200", ring: "ring-amber-500/30" },
  firing: { dot: "bg-orange-400 animate-ping", text: "text-orange-200", ring: "ring-orange-500/40" },
  success: { dot: "bg-emerald-400", text: "text-emerald-200", ring: "ring-emerald-500/40" },
  warning: { dot: "bg-amber-400", text: "text-amber-200", ring: "ring-amber-500/40" },
  error: { dot: "bg-rose-400", text: "text-rose-200", ring: "ring-rose-500/40" },
};

export const FloatingHUD: React.FC<FloatingHUDProps> = ({ onClose, hostElement }) => {
  const [minimized, setMinimized] = useState(false);
  const [isArmed, setIsArmed] = useState(false);
  const [shopeeTimeStr, setShopeeTimeStr] = useState("--:--:--.---");
  const [offsetMs, setOffsetMs] = useState(0);
  const [errorMs, setErrorMs] = useState(1000);
  const [calibrated, setCalibrated] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone: Tone }>({
    text: "Pick the voucher's Save button, then arm.",
    tone: "idle",
  });
  const [targetSlot, setTargetSlot] = useState<"next_flash" | "next_minute">("next_flash");
  const [countdownStr, setCountdownStr] = useState("--:--.-");
  const [targetLabel, setTargetLabel] = useState("--:--:--");
  const [targetSummary, setTargetSummary] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const targetElementRef = useRef<HTMLElement | null>(null);
  const cancelHuntRef = useRef<(() => void) | null>(null);

  // Drop time in Vietnam time (Shopee VN drops are GMT+7 whatever this computer's timezone is)
  const computeTargetTimestamp = (now: number, mode: "next_flash" | "next_minute") => {
    if (mode === "next_minute") {
      const at = Math.floor(now / 60000) * 60000 + 60000;
      return { timestamp: at, label: formatVN(at).slice(0, 8) };
    }
    const { at } = nextFlashDrop(SHOPEE_FLASH_HOURS, now);
    return { timestamp: at, label: formatVN(at).slice(0, 8) };
  };

  // Clock display only; the hunt itself runs on the Web Worker ticker in the hunt engine
  useEffect(() => {
    const updateClock = () => {
      const now = timeSyncClient.getShopeeTime();
      setShopeeTimeStr(formatVN(now));
      setOffsetMs(timeSyncClient.getOffset());
      setErrorMs(timeSyncClient.getErrorMs());
      setCalibrated(timeSyncClient.getIsCalibrated());

      const { timestamp, label } = computeTargetTimestamp(now, targetSlot);
      setTargetLabel(label);
      const diff = Math.max(0, timestamp - now);
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      const tenth = Math.floor((diff % 1000) / 100);
      const mmss = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${tenth}`;
      setCountdownStr(h > 0 ? `${h}:${mmss}` : mmss);
    };

    updateClock();
    const interval = setInterval(updateClock, 50);
    return () => clearInterval(interval);
  }, [targetSlot]);

  useEffect(() => () => cancelHuntRef.current?.(), []);

  const isOwnEvent = (e: Event) => !!hostElement && e.composedPath().includes(hostElement);

  const lockTarget = (el: HTMLElement) => {
    targetElementRef.current?.classList.remove("dh-target-highlight");
    el.classList.add("dh-target-highlight");
    targetElementRef.current = el;
    const card = elementResolver.describe(el).cardText;
    setTargetSummary(card ? card.slice(0, 60) : (el.innerText || "Save button").trim());
  };

  // Pick a target: lock on pointerdown because Chrome does not fire click on a disabled button,
  // and Shopee's "Lưu" is usually disabled until the drop.
  const handleSelectTarget = () => {
    setPicking(true);
    setStatus({ text: "Hover the voucher's Save button and click it to lock.", tone: "armed" });

    const onMouseOver = (e: MouseEvent) => {
      if (!isOwnEvent(e)) (e.target as HTMLElement).classList.add("dh-target-hover");
    };
    const onMouseOut = (e: MouseEvent) => {
      (e.target as HTMLElement).classList?.remove("dh-target-hover");
    };
    const onPick = (e: PointerEvent) => {
      if (isOwnEvent(e)) return;
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).classList?.remove("dh-target-hover");

      const el = elementResolver.normalizeTarget(e.target as HTMLElement);
      lockTarget(el);
      setPicking(false);
      setStatus({ text: "Target locked. Arm the sniper when ready.", tone: "idle" });

      window.removeEventListener("mouseover", onMouseOver);
      window.removeEventListener("mouseout", onMouseOut);
      window.removeEventListener("pointerdown", onPick, true);

      // Swallow the click that follows on an enabled button so picking it does not save the voucher early
      const swallow = (ev: MouseEvent) => {
        if (!el.contains(ev.target as Node)) return;
        ev.preventDefault();
        ev.stopPropagation();
        window.removeEventListener("click", swallow, true);
      };
      window.addEventListener("click", swallow, true);
      setTimeout(() => window.removeEventListener("click", swallow, true), 600);
    };

    window.addEventListener("mouseover", onMouseOver);
    window.addEventListener("mouseout", onMouseOut);
    window.addEventListener("pointerdown", onPick, true);
  };

  // Auto-detect: lock the first voucher Save button that can be clicked right now
  const handleAutoDetect = () => {
    const buttons = elementResolver.findCollectButtons();
    if (buttons.length > 0) {
      lockTarget(buttons[0]);
      setStatus({
        text: `Found ${buttons.length} button(s); locked the first one — check the green outline.`,
        tone: "idle",
      });
    } else {
      setStatus({ text: "No clickable Save button on this page right now.", tone: "error" });
    }
  };

  // Arm: the hunt engine waits for the drop, re-finds the button and reports what the page shows
  const armHunt = () => {
    const now = timeSyncClient.getShopeeTime();
    const { timestamp } = computeTargetTimestamp(now, targetSlot);
    setIsArmed(true);
    setStatus({ text: "Armed — waiting for the drop.", tone: "armed" });
    cancelHuntRef.current = startHunt({
      targetTimestamp: timestamp,
      now: () => timeSyncClient.getShopeeTime(),
      locked: targetElementRef.current,
      onStatus: (msg) => setStatus({ text: msg, tone: msg.startsWith("Saving") ? "firing" : "armed" }),
      onDone: (outcome) => {
        cancelHuntRef.current = null;
        setIsArmed(false);
        const view = RESULT_VIEW[outcome.result];
        setStatus({ text: `${view.text} · ${outcome.clicks} clicks`, tone: view.tone });
      },
    });
  };

  const disarmHunt = () => {
    cancelHuntRef.current?.();
    cancelHuntRef.current = null;
    setIsArmed(false);
  };

  const handleManualTestClick = () => {
    if (targetElementRef.current) {
      humanClicker.dispatchClick(targetElementRef.current);
      setStatus({ text: "Sent 1 real test click to the locked button.", tone: "idle" });
    } else {
      handleAutoDetect();
    }
  };

  const handleRecalibrate = async () => {
    setSyncing(true);
    setStatus({ text: "Syncing with Shopee's clock...", tone: "idle" });
    await timeSyncClient.calibrate();
    setSyncing(false);
    setStatus({
      text: timeSyncClient.getIsCalibrated() ? "Clock synced with Shopee." : "Could not sync — check your connection.",
      tone: timeSyncClient.getIsCalibrated() ? "success" : "error",
    });
  };

  const tone = TONE_STYLES[status.tone];
  const StatusIcon =
    status.tone === "success" ? CircleCheck : status.tone === "error" ? CircleX : status.tone === "warning" ? CircleAlert : null;

  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className="flex items-center gap-2.5 rounded-full bg-slate-950/95 px-4 py-2 text-white shadow-2xl ring-1 ring-white/10 transition hover:ring-emerald-400/50"
      >
        <span className={`h-2 w-2 rounded-full ${isArmed ? "bg-amber-400 animate-pulse" : "bg-emerald-400"}`} />
        <span className="font-mono text-sm font-semibold tabular-nums text-emerald-300">{shopeeTimeStr}</span>
        {isArmed && <span className="font-mono text-xs tabular-nums text-amber-300">T-{countdownStr}</span>}
        <Maximize2 className="h-3.5 w-3.5 text-slate-400" />
      </button>
    );
  }

  return (
    <div className="w-[340px] select-none overflow-hidden rounded-3xl bg-slate-950/95 text-slate-100 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.6)] ring-1 ring-white/10 backdrop-blur-xl">
      {/* Header */}
      <div className="flex items-center justify-between bg-gradient-to-r from-emerald-500/15 via-teal-500/10 to-transparent px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 text-[11px] font-black text-white shadow-lg shadow-emerald-900/50">
            DH
          </div>
          <div className="leading-tight">
            <div className="text-[13px] font-bold tracking-tight">DealHunter</div>
            <div className="text-[10px] font-medium text-slate-400">Voucher Sniper · Shopee</div>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setMinimized(true)}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/5 hover:text-slate-100"
            title="Minimize"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/5 hover:text-slate-100"
              title="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3 px-4 pb-4 pt-1">
        {/* Shopee clock */}
        <div className="rounded-2xl bg-white/[0.03] p-3 ring-1 ring-white/5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Shopee server time</span>
            <button
              type="button"
              onClick={handleRecalibrate}
              disabled={syncing}
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 transition ${
                calibrated
                  ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30 hover:bg-emerald-500/20"
                  : "bg-rose-500/10 text-rose-300 ring-rose-500/30 hover:bg-rose-500/20"
              }`}
              title="Re-sync with Shopee's clock"
            >
              <RefreshCw className={`h-2.5 w-2.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing
                ? "Syncing..."
                : calibrated
                ? `${offsetMs >= 0 ? "+" : ""}${offsetMs} ms ±${errorMs}`
                : "Not synced · retry"}
            </button>
          </div>
          <div className="mt-1 text-center font-mono text-[28px] font-bold leading-none tabular-nums tracking-tight text-emerald-300">
            {shopeeTimeStr}
          </div>
        </div>

        {/* Drop target */}
        <div className="rounded-2xl bg-white/[0.03] p-3 ring-1 ring-white/5">
          <div className="flex items-center justify-between">
            <div className="flex rounded-lg bg-black/30 p-0.5 ring-1 ring-white/5">
              {(
                [
                  ["next_flash", "Next flash sale"],
                  ["next_minute", "Next minute"],
                ] as const
              ).map(([slot, label]) => (
                <button
                  key={slot}
                  type="button"
                  disabled={isArmed}
                  onClick={() => setTargetSlot(slot)}
                  className={`rounded-md px-2.5 py-1 text-[10px] font-semibold transition ${
                    targetSlot === slot ? "bg-emerald-500 text-white shadow" : "text-slate-400 hover:text-slate-200"
                  } disabled:cursor-not-allowed`}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="font-mono text-xs font-semibold tabular-nums text-slate-300">{targetLabel}</span>
          </div>
          <div className="mt-2.5 flex items-end justify-between">
            <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              <Timer className="h-3 w-3" /> Drop in
            </span>
            <span
              className={`font-mono text-xl font-bold leading-none tabular-nums ${
                isArmed ? "text-amber-300" : "text-slate-100"
              }`}
            >
              {countdownStr}
            </span>
          </div>
        </div>

        {/* Target voucher */}
        <div className="rounded-2xl bg-white/[0.03] p-3 ring-1 ring-white/5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Target voucher</span>
            {targetSummary ? (
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                Locked
              </span>
            ) : (
              <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-slate-400 ring-1 ring-white/10">
                Opens at drop
              </span>
            )}
          </div>
          <p className="mb-2.5 truncate text-[11px] text-slate-300" title={targetSummary ?? undefined}>
            {targetSummary ?? "Not picked — only a voucher that opens exactly at the drop will be clicked."}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleSelectTarget}
              disabled={isArmed || picking}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-white/5 py-2 text-[11px] font-semibold text-slate-100 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-40"
            >
              <Crosshair className="h-3.5 w-3.5 text-emerald-300" />
              {picking ? "Click a button..." : "Pick button"}
            </button>
            <button
              type="button"
              onClick={handleAutoDetect}
              disabled={isArmed}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-white/5 py-2 text-[11px] font-semibold text-slate-100 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-40"
            >
              <ScanSearch className="h-3.5 w-3.5 text-emerald-300" />
              Auto-detect
            </button>
          </div>
        </div>

        {/* Arm */}
        <button
          type="button"
          onClick={() => (isArmed ? disarmHunt() : armHunt())}
          className={`flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold text-white shadow-lg transition ${
            isArmed
              ? "bg-gradient-to-r from-rose-500 to-rose-600 shadow-rose-950/50 hover:from-rose-400 hover:to-rose-500"
              : "bg-gradient-to-r from-emerald-500 to-teal-500 shadow-emerald-950/50 hover:from-emerald-400 hover:to-teal-400"
          }`}
        >
          <Zap className="h-4 w-4" />
          {isArmed ? "Disarm" : "Arm sniper"}
        </button>

        <button
          type="button"
          onClick={handleManualTestClick}
          disabled={isArmed}
          className="flex w-full items-center justify-center gap-1.5 text-[11px] font-medium text-slate-400 transition hover:text-slate-200 disabled:opacity-40"
          title="Sends one real click — it saves the voucher if it is already open"
        >
          <MousePointerClick className="h-3.5 w-3.5" />
          Send one test click
        </button>

        {/* Status */}
        <div className={`flex items-start gap-2 rounded-xl bg-black/30 px-3 py-2 ring-1 ${tone.ring}`}>
          {StatusIcon ? (
            <StatusIcon className={`mt-px h-3.5 w-3.5 shrink-0 ${tone.text}`} />
          ) : (
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
          )}
          <span className={`text-[11px] leading-snug ${tone.text}`}>{status.text}</span>
        </div>
      </div>
    </div>
  );
};
