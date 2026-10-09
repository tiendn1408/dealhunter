import React, { useEffect, useMemo, useState } from "react";
import { CalendarClock, Plus, Bookmark, Globe, Crosshair, Sparkles, CheckCircle2, ChevronDown } from "lucide-react";
import { ScheduledTask, SavedPageTarget } from "../../lib/types";
import { storage } from "../../lib/storage";
import { nextExactDropAt, formatVN } from "../../lib/drop_time";
import { taskScheduler } from "../../background/scheduler";
import { MESSAGE_ACTIONS } from "../../lib/constants";
import { Language, getTranslation } from "../../lib/i18n";

interface ScheduleFormProps {
  onTaskCreated: () => void;
  lang?: Language;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Calculates the next upcoming popular flash sale drop time in Vietnam (UTC+7).
 * Standard sales occur at 00:00, 09:00, 12:00, 18:00, 21:00.
 */
function getNextSaleDrop(nowMs: number): { timeStr: string; label: string; hour: number } {
  const vnTime = new Date(nowMs + 7 * 3600 * 1000);
  const currH = vnTime.getUTCHours();
  const currM = vnTime.getUTCMinutes();
  const totalMinutes = currH * 60 + currM;

  const popularSaleHours = [0, 9, 12, 18, 21];
  let nextH = popularSaleHours.find((h) => h * 60 > totalMinutes);
  if (nextH === undefined) {
    nextH = 0; // Next drop is tomorrow midnight
  }

  return {
    hour: nextH,
    timeStr: `${pad(nextH)}:00:00`,
    label: `${pad(nextH)}:00`,
  };
}

export const ScheduleForm: React.FC<ScheduleFormProps> = ({ onTaskCreated, lang = "en" }) => {
  const [targetMode, setTargetMode] = useState<"current" | "saved" | "custom">("current");
  const [savedTargets, setSavedTargets] = useState<SavedPageTarget[]>([]);
  const [selectedSavedId, setSelectedSavedId] = useState<string>("");

  // Current tab state
  const [currentTabUrl, setCurrentTabUrl] = useState<string>("");
  const [currentTabDomain, setCurrentTabDomain] = useState<string>("");
  const [currentTabTarget, setCurrentTabTarget] = useState<SavedPageTarget | null>(null);

  // Custom link state
  const [customUrl, setCustomUrl] = useState<string>("");

  // Target time state
  const nextSale = useMemo(() => getNextSaleDrop(Date.now()), []);
  const [timeInput, setTimeInput] = useState<string>(nextSale.timeStr);
  const [submitting, setSubmitting] = useState(false);
  const t = getTranslation(lang);

  // 1. Detect active browser tab & saved target for this tab
  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const tab = tabs[0];
        if (tab?.url && (tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
          setCurrentTabUrl(tab.url);
          try {
            const host = new URL(tab.url).hostname.replace(/^www\./, "");
            setCurrentTabDomain(host);
          } catch {
            setCurrentTabDomain("web");
          }

          const pageTarget = await storage.getSavedTargetForUrl(tab.url);
          if (pageTarget) {
            setCurrentTabTarget(pageTarget);
            setTargetMode("current");
            if (pageTarget.targetSlot === "midnight") setTimeInput("00:00:00");
            else if (pageTarget.customTime) setTimeInput(pageTarget.customTime);
          }
        } else {
          setTargetMode("saved");
        }
      });
    }

    // 2. Load all saved targets
    storage.getSavedPageTargets().then((targets) => {
      setSavedTargets(targets);
      if (targets.length > 0) {
        setSelectedSavedId(targets[0].id);
      }
    });
  }, []);

  // Parse time input into h, m, s
  const parsedTime = useMemo(() => {
    const parts = timeInput.split(":").map((p) => parseInt(p.trim(), 10));
    const h = Number.isFinite(parts[0]) && parts[0] >= 0 && parts[0] < 24 ? parts[0] : 0;
    const m = Number.isFinite(parts[1]) && parts[1] >= 0 && parts[1] < 60 ? parts[1] : 0;
    const s = Number.isFinite(parts[2]) && parts[2] >= 0 && parts[2] < 60 ? parts[2] : 0;
    return { h, m, s, timeStr: `${pad(h)}:${pad(m)}:${pad(s)}` };
  }, [timeInput]);

  // When this hunt will actually run in Vietnam time
  const runsAt = useMemo(() => {
    const at = nextExactDropAt(parsedTime.h, parsedTime.m, parsedTime.s, Date.now());
    const isSameDay =
      new Date(at + 7 * 3600 * 1000).getUTCDate() === new Date(Date.now() + 7 * 3600 * 1000).getUTCDate();
    const dayLabel = isSameDay ? t.today : t.tomorrow;
    return `${dayLabel} ${parsedTime.timeStr}`;
  }, [parsedTime, t]);

  const altSale1 = nextSale.label === "00:00" ? "09:00" : "00:00";
  const altSale2 = nextSale.label === "12:00" ? "18:00" : "12:00";

  const handleQuickTime = (val: string) => {
    if (val === "nextSale") {
      setTimeInput(nextSale.timeStr);
    } else if (val === "plus5m") {
      const at = Date.now() + 5 * 60 * 1000;
      setTimeInput(formatVN(at).slice(0, 8));
    } else {
      setTimeInput(`${val}:00`);
    }
  };

  const handleOpenPageAndPick = () => {
    if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id;
        if (tabId) {
          chrome.tabs.sendMessage(tabId, { action: MESSAGE_ACTIONS.ACTIVATE_HUD, pickTarget: true });
          window.close();
        }
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    let finalUrl = "";
    let finalLabel = "";
    let targetSnapshot: SavedPageTarget | undefined;

    if (targetMode === "current") {
      finalUrl = currentTabUrl;
      targetSnapshot = currentTabTarget || undefined;
      const targetName = targetSnapshot?.name || currentTabDomain;
      finalLabel = `${parsedTime.timeStr} · ${targetName}`;
    } else if (targetMode === "saved") {
      targetSnapshot = savedTargets.find((t) => t.id === selectedSavedId);
      if (!targetSnapshot) return;
      finalUrl = targetSnapshot.url;
      finalLabel = `${parsedTime.timeStr} · ${targetSnapshot.name}`;
    } else {
      finalUrl = customUrl.trim();
      if (!finalUrl) return;
      let host = "Web";
      try {
        host = new URL(finalUrl).hostname.replace(/^www\./, "");
      } catch {
        // ignore
      }
      finalLabel = `${parsedTime.timeStr} · ${host}`;
    }

    setSubmitting(true);
    try {
      const newTask: ScheduledTask = {
        id: Math.random().toString(36).substring(2, 9),
        targetHour: parsedTime.h,
        targetMinute: parsedTime.m,
        targetSecond: parsedTime.s,
        targetUrl: finalUrl,
        label: finalLabel,
        mode: "full_auto",
        savedTargetId: targetSnapshot?.id,
        descriptor: targetSnapshot?.descriptor,
        dualDefenseReload: true,
        diagnostics: targetSnapshot?.diagnostics,
        preWarmSeconds: 60, // Optimal autonomous pre-warm lead time
        status: "pending",
        createdAt: Date.now(),
      };

      try {
        await chrome.runtime.sendMessage({ action: MESSAGE_ACTIONS.SCHEDULE_TASK, task: newTask });
      } catch {
        await taskScheduler.scheduleTask(newTask);
      }
      onTaskCreated();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3.5 rounded-2xl bg-white/[0.03] p-3.5 ring-1 ring-white/10">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30">
              <CalendarClock className="h-3.5 w-3.5" />
            </div>
            <h2 className="text-[13px] font-semibold text-slate-100">{t.scheduleTitle}</h2>
          </div>
          <span className="shrink-0 whitespace-nowrap rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-semibold text-emerald-300 ring-1 ring-emerald-500/25">
            {t.fullyAutomatic}
          </span>
        </div>
        <p className="text-[10px] leading-relaxed text-slate-400 pl-8">
          {t.scheduleSubtitle}
        </p>
      </div>

      {/* 1. Target Selector (Current tab vs Saved buttons vs Custom) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-semibold text-slate-300">{t.targetSelectorLabel}</label>
        </div>

        {/* Mode Selector Tabs */}
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-black/40 p-1 ring-1 ring-white/5 text-[10px] font-semibold">
          <button
            type="button"
            onClick={() => setTargetMode("current")}
            disabled={!currentTabUrl}
            className={`flex items-center justify-center gap-1 rounded-lg px-1 py-1.5 whitespace-nowrap transition ${
              targetMode === "current"
                ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40"
                : "text-slate-400 hover:text-slate-200 disabled:opacity-40"
            }`}
          >
            <Globe className="h-3 w-3 shrink-0" />
            <span>{t.targetModeCurrentTab}</span>
          </button>

          <button
            type="button"
            onClick={() => setTargetMode("saved")}
            className={`flex items-center justify-center gap-1 rounded-lg px-1 py-1.5 whitespace-nowrap transition ${
              targetMode === "saved"
                ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Bookmark className="h-3 w-3 shrink-0" />
            <span>{t.targetModeSavedList}</span>
          </button>

          <button
            type="button"
            onClick={() => setTargetMode("custom")}
            className={`flex items-center justify-center gap-1 rounded-lg px-1 py-1.5 whitespace-nowrap transition ${
              targetMode === "custom"
                ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Plus className="h-3 w-3 shrink-0" />
            <span>{t.targetModeCustomUrl}</span>
          </button>
        </div>

        {/* Mode Content: Current Tab */}
        {targetMode === "current" && (
          <div className="rounded-xl bg-black/40 p-2.5 ring-1 ring-white/5 space-y-2 h-[68px] flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] font-bold text-slate-200 truncate">{currentTabDomain}</span>
              {currentTabTarget ? (
                <span className="shrink-0 flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold text-emerald-300 ring-1 ring-emerald-500/30">
                  <CheckCircle2 className="h-2.5 w-2.5" />
                  {t.locked}
                </span>
              ) : (
                <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-medium text-amber-300 ring-1 ring-amber-500/30">
                  {t.opensAtDrop}
                </span>
              )}
            </div>

            {currentTabTarget ? (
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[10px] text-slate-400 shrink-0">{t.targetOnCurrentPage}</span>
                  <span className="font-mono text-[11px] font-bold text-emerald-300 truncate">
                    {currentTabTarget.name}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleOpenPageAndPick}
                  className="shrink-0 rounded-lg bg-white/5 px-2 py-1 text-[9px] font-semibold text-slate-300 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-emerald-300"
                >
                  {t.pickTargetOnCurrentPage}
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/5">
                <span className="text-[10px] text-slate-400 whitespace-nowrap">{t.noTargetOnCurrentPage}</span>
                <button
                  type="button"
                  onClick={handleOpenPageAndPick}
                  className="shrink-0 flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 py-1 text-[9px] font-bold text-emerald-300 ring-1 ring-emerald-500/30 transition hover:bg-emerald-500/25"
                >
                  <Crosshair className="h-2.5 w-2.5" />
                  <span>{t.pickTargetOnCurrentPage}</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Mode Content: Saved Targets List */}
        {targetMode === "saved" && (
          <div className="rounded-xl bg-black/40 p-2.5 ring-1 ring-white/5 space-y-2 h-[68px] flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-medium text-slate-400">{t.savedTargetsLabel}</span>
              <span className="font-mono text-[9px] font-bold text-emerald-400/90 rounded bg-emerald-500/10 px-1.5 py-0.5 ring-1 ring-emerald-500/20">
                {savedTargets.length}
              </span>
            </div>

            {savedTargets.length > 0 ? (
              <div className="relative">
                <select
                  value={selectedSavedId}
                  onChange={(e) => setSelectedSavedId(e.target.value)}
                  className="w-full appearance-none rounded-lg bg-white/5 pl-2.5 pr-8 py-1 text-[11px] font-medium text-slate-100 ring-1 ring-white/10 outline-none focus:ring-1 focus:ring-emerald-400 cursor-pointer truncate"
                >
                  {savedTargets.map((target) => (
                    <option key={target.id} value={target.id} className="bg-slate-900 text-slate-100">
                      {target.name} · {target.origin.replace(/^https?:\/\/(www\.)?/, "")}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              </div>
            ) : (
              <p className="text-[10px] text-slate-500 italic truncate py-0.5">
                {t.noSavedButtonsYet}
              </p>
            )}
          </div>
        )}

        {/* Mode Content: Custom Link */}
        {targetMode === "custom" && (
          <div className="rounded-xl bg-black/40 p-2.5 ring-1 ring-white/5 space-y-2 h-[68px] flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-medium text-slate-400">{t.targetPageLabel}</span>
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-medium text-amber-300 ring-1 ring-amber-500/30 shrink-0">
                {t.opensAtDrop}
              </span>
            </div>

            <input
              type="url"
              required
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder={t.customUrlPlaceholder}
              className="w-full rounded-lg bg-white/5 px-2.5 py-1 text-[11px] text-slate-100 ring-1 ring-white/10 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-400 font-mono"
            />
          </div>
        )}
      </div>

      {/* 2. Target Time with Smart Sale Drop Predictor */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-semibold text-slate-300">{t.exactTimePrompt}</label>
          <span className="font-mono text-[10px] font-semibold text-emerald-400">{runsAt}</span>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            required
            value={timeInput}
            onChange={(e) => setTimeInput(e.target.value)}
            placeholder="HH:mm:ss"
            className="w-24 shrink-0 rounded-xl bg-black/40 px-2 py-1.5 text-center font-mono text-sm font-bold text-emerald-300 ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-emerald-400"
          />
          <div className="flex flex-1 items-center gap-1">
            {[
              { label: nextSale.label, val: nextSale.label },
              { label: altSale1, val: altSale1 },
              { label: altSale2, val: altSale2 },
              { label: "+5m", val: "+5m" },
            ].map((p) => {
              const isSelected = p.val !== "+5m" && timeInput.startsWith(p.val);
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() =>
                    handleQuickTime(
                      p.val === nextSale.label
                        ? "nextSale"
                        : p.val === "+5m"
                        ? "plus5m"
                        : p.val
                    )
                  }
                  className={`flex-1 rounded-lg py-1.5 text-[10px] transition text-center whitespace-nowrap ${
                    isSelected
                      ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40 font-bold"
                      : "bg-white/5 text-slate-300 ring-1 ring-white/10 font-medium hover:bg-white/10 hover:text-slate-100"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={
          submitting ||
          (targetMode === "current" && !currentTabUrl) ||
          (targetMode === "saved" && savedTargets.length === 0) ||
          (targetMode === "custom" && !customUrl.trim())
        }
        className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-2.5 text-[13px] font-bold text-slate-950 shadow-lg shadow-emerald-950/50 transition hover:from-emerald-400 hover:to-teal-400 disabled:opacity-50"
      >
        <Plus className="h-4 w-4" />
        {t.scheduleSubmitBtn(parsedTime.timeStr)}
      </button>
    </form>
  );
};
