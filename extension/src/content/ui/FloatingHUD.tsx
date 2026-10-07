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
  Clock,
  CheckCircle2,
  X,
  Minimize2,
  Maximize2,
  RefreshCw,
} from "lucide-react";

interface FloatingHUDProps {
  onClose?: () => void;
}

export const FloatingHUD: React.FC<FloatingHUDProps> = ({ onClose }) => {
  const [minimized, setMinimized] = useState(false);
  const [isArmed, setIsArmed] = useState(false);
  const [isBursting, setIsBursting] = useState(false);
  const [targetFound, setTargetFound] = useState(false);
  const [shopeeTimeStr, setShopeeTimeStr] = useState("00:00:00.000");
  const [offsetMs, setOffsetMs] = useState(0);
  const [statusMessage, setStatusMessage] = useState("Cho lenh");
  const [isFinished, setIsFinished] = useState(false);
  const [targetSlot, setTargetSlot] = useState<"next_flash" | "next_minute">("next_flash");
  const [countdownStr, setCountdownStr] = useState<string>("");
  const [targetLabel, setTargetLabel] = useState<string>("");

  const targetElementRef = useRef<HTMLElement | null>(null);
  const cancelHuntRef = useRef<(() => void) | null>(null);
  const [errorMs, setErrorMs] = useState(1000);
  const [calibrated, setCalibrated] = useState(false);

  // Target timestamp in Vietnam time (Shopee VN drops are GMT+7 whatever this computer's timezone is)
  const computeTargetTimestamp = (now: number, mode: "next_flash" | "next_minute") => {
    if (mode === "next_minute") {
      const at = Math.floor(now / 60000) * 60000 + 60000;
      return { timestamp: at, label: formatVN(at).slice(0, 8) };
    }
    const { at } = nextFlashDrop(SHOPEE_FLASH_HOURS, now);
    return { timestamp: at, label: formatVN(at).slice(0, 8) };
  };

  // 1. Clock display only; the hunt itself runs on the Web Worker ticker in the hunt engine
  useEffect(() => {
    const updateClock = () => {
      const now = timeSyncClient.getShopeeTime();
      setShopeeTimeStr(formatVN(now));
      setOffsetMs(timeSyncClient.getOffset());
      setErrorMs(timeSyncClient.getErrorMs());
      setCalibrated(timeSyncClient.getIsCalibrated());

      const { timestamp, label } = computeTargetTimestamp(now, targetSlot);
      setTargetLabel(label);
      const diff = timestamp - now;
      if (diff > 0) {
        const cdMin = Math.floor(diff / 60000);
        const cdSec = Math.floor((diff % 60000) / 1000);
        const cdMs = Math.floor((diff % 1000) / 100);
        setCountdownStr(`${String(cdMin).padStart(2, "0")}:${String(cdSec).padStart(2, "0")}.${cdMs}`);
      } else {
        setCountdownStr("00:00.0");
      }
    };

    const interval = setInterval(updateClock, 50);
    return () => clearInterval(interval);
  }, [targetSlot]);

  useEffect(() => () => cancelHuntRef.current?.(), []);

  // 2. Select / lock target button
  const handleSelectTarget = () => {
    setStatusMessage("Re chuot vao nut Luu tren man hinh de chon");
    const onMouseOver = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      el.classList.add("dh-target-highlight");
    };
    const onMouseOut = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      el.classList.remove("dh-target-highlight");
    };
    // Lock on pointerdown: Chrome does not fire click on a disabled button, and Shopee's "Lưu" is usually
    // disabled until the drop.
    const onPick = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const el = elementResolver.normalizeTarget(e.target as HTMLElement);
      el.classList.add("dh-target-highlight");
      targetElementRef.current = el;
      setTargetFound(true);
      setStatusMessage("Da khoa nut muc tieu");

      window.removeEventListener("mouseover", onMouseOver);
      window.removeEventListener("mouseout", onMouseOut);
      window.removeEventListener("pointerdown", onPick, true);

      // Swallow the click that follows on an enabled button so picking it does not save the voucher early
      const swallow = (ev: MouseEvent) => {
        if (!el.contains(ev.target as Node)) return; // only the click on the picked button itself
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

  // 3. Auto-detect first available collect button if not manually picked
  const handleAutoDetect = () => {
    const buttons = elementResolver.findCollectButtons();
    if (buttons.length > 0) {
      if (targetElementRef.current) {
        targetElementRef.current.classList.remove("dh-target-highlight");
      }
      targetElementRef.current = buttons[0];
      targetElementRef.current.classList.add("dh-target-highlight");
      setTargetFound(true);
      setStatusMessage(`Da tim thay ${buttons.length} nut (Da khoa nut dau tien)`);
    } else {
      setStatusMessage("Khong tim thay nut phu hop tren trang nay");
    }
  };

  // 4. Arm: the hunt engine waits for the drop, re-finds the button and reports what the page shows
  const RESULT_MESSAGES: Record<HuntOutcome["result"], string> = {
    saved: "DA LUU MA (trang xac nhan)",
    exhausted: "Voucher da het luot",
    not_found: "Khong thay nut voucher trong khung gio",
    timeout: "Da click nhung trang chua xac nhan da luu - hay kiem tra vi voucher",
    cancelled: "Da tam dung",
  };

  const armHunt = () => {
    const now = timeSyncClient.getShopeeTime();
    const { timestamp } = computeTargetTimestamp(now, targetSlot);
    setIsArmed(true);
    setIsFinished(false);
    setStatusMessage("Da bat che do san");
    cancelHuntRef.current = startHunt({
      targetTimestamp: timestamp,
      now: () => timeSyncClient.getShopeeTime(),
      locked: targetElementRef.current,
      onStatus: (msg) => {
        setIsBursting(msg.startsWith("Dang luu"));
        setStatusMessage(msg);
      },
      onDone: (outcome) => {
        cancelHuntRef.current = null;
        setIsBursting(false);
        setIsArmed(false);
        setIsFinished(outcome.result !== "cancelled");
        setStatusMessage(`${RESULT_MESSAGES[outcome.result]} (${outcome.clicks} click)`);
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
      setStatusMessage("Da gui 1 click thu nghiem");
    } else {
      handleAutoDetect();
    }
  };

  const handleRecalibrate = async () => {
    setStatusMessage("Dang do lai gio Shopee...");
    await timeSyncClient.calibrate();
    setOffsetMs(timeSyncClient.getOffset());
    setStatusMessage("Da dong bo gio Shopee");
  };

  if (minimized) {
    return (
      <div
        onClick={() => setMinimized(false)}
        className="bg-slate-900 text-white px-3.5 py-2 rounded-2xl shadow-xl flex items-center gap-2 cursor-pointer hover:bg-slate-800 transition-all border border-emerald-500/30"
      >
        <Zap className={`w-4 h-4 ${isArmed ? "text-emerald-400 animate-pulse" : "text-slate-400"}`} />
        <span className="font-mono text-xs font-bold text-emerald-400">{shopeeTimeStr}</span>
        <Maximize2 className="w-3.5 h-3.5 text-slate-400" />
      </div>
    );
  }

  return (
    <div className="bg-slate-900/95 backdrop-blur-md text-white w-80 rounded-3xl shadow-2xl p-4 border border-slate-800 space-y-3.5 select-none animate-in fade-in zoom-in-95 duration-200">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">
            DH
          </div>
          <div>
            <div className="text-xs font-black tracking-tight flex items-center gap-1.5 text-slate-100">
              DealHunter Assistant
              <span className="text-[10px] font-semibold px-1.5 py-0.2 bg-emerald-500/20 text-emerald-300 rounded-md">
                Shopee
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMinimized(true)}
            className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200"
            title="Thu nho"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200"
              title="Dong"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Shopee Server Clock */}
      <div className="bg-slate-950/80 rounded-2xl p-3 border border-slate-800/80 space-y-1">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3 text-emerald-400" />
            Gio Shopee Server
          </span>
          <button
            type="button"
            onClick={handleRecalibrate}
            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-emerald-400 transition-colors"
          >
            <RefreshCw className="w-2.5 h-2.5" />
            <span className={calibrated ? "" : "text-rose-400"}>
              {calibrated
                ? `${offsetMs >= 0 ? "+" : ""}${offsetMs}ms ±${errorMs}ms`
                : "CHUA DONG BO - bam de do lai"}
            </span>
          </button>
        </div>
        <div className="font-mono text-xl font-black text-emerald-400 tracking-wider text-center">
          {shopeeTimeStr}
        </div>
      </div>

      {/* Target Slot & Countdown */}
      <div className="bg-slate-950/60 rounded-2xl p-2.5 border border-slate-800/60 space-y-1.5">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-slate-400">Muc tieu: <strong className="text-emerald-400">{targetLabel}</strong></span>
          <div className="flex bg-slate-900 rounded-lg p-0.5 border border-slate-800">
            <button
              type="button"
              onClick={() => setTargetSlot("next_flash")}
              className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                targetSlot === "next_flash" ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Gio Vang
            </button>
            <button
              type="button"
              onClick={() => setTargetSlot("next_minute")}
              className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                targetSlot === "next_minute" ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Phut Toi
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400 text-[11px]">Dem nguoc:</span>
          <span className={`font-mono font-black ${isArmed ? "text-amber-400 animate-pulse" : "text-slate-200"}`}>
            {countdownStr}
          </span>
        </div>
      </div>

      {/* Controls Grid */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={handleSelectTarget}
          className="flex items-center justify-center gap-1.5 py-2 px-3 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-xl text-slate-200 transition-all border border-slate-700"
        >
          <Crosshair className="w-3.5 h-3.5 text-emerald-400" />
          <span>Tro Chon Nut</span>
        </button>

        <button
          type="button"
          onClick={handleAutoDetect}
          className="flex items-center justify-center gap-1.5 py-2 px-3 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-xl text-slate-200 transition-all border border-slate-700"
        >
          <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
          <span>Tu Tim Nut</span>
        </button>
      </div>

      {/* Arm Toggle Button */}
      <button
        type="button"
        onClick={() => (isArmed ? disarmHunt() : armHunt())}
        className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all ${
          isArmed
            ? "bg-rose-600 hover:bg-rose-700 text-white shadow-lg shadow-rose-900/40"
            : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/40"
        }`}
      >
        <Zap className="w-4 h-4" />
        <span>{isArmed ? "TAT SAN MA (DANG SAN SANG)" : "BAT SAN MA (SEMI-AUTO)"}</span>
      </button>

      {/* Direct Burst Test Button */}
      <button
        type="button"
        onClick={handleManualTestClick}
        className="w-full py-1.5 px-3 bg-slate-800/80 hover:bg-slate-700/80 text-[11px] text-slate-400 hover:text-slate-200 rounded-lg transition-colors text-center"
      >
        Click thu nghiem 1 cham
      </button>

      {/* Status Bar */}
      <div className="text-[11px] px-2.5 py-1.5 bg-slate-950/50 rounded-xl text-slate-400 border border-slate-800/50 flex items-center gap-2">
        <div
          className={`w-2 h-2 rounded-full shrink-0 ${
            isBursting
              ? "bg-amber-400 animate-ping"
              : isArmed
              ? "bg-emerald-400 animate-pulse"
              : isFinished
              ? "bg-emerald-500"
              : "bg-slate-600"
          }`}
        />
        <span className="truncate">{statusMessage}</span>
      </div>
    </div>
  );
};
