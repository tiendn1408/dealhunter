import React, { useEffect, useMemo, useState } from "react";
import { CalendarClock, Plus, Bookmark, Globe, Crosshair, CheckCircle2, ChevronDown, Repeat } from "lucide-react";
import { ScheduledTask, SavedPageTarget, ClickProfileMode } from "../../lib/types";
import { storage } from "../../lib/storage";
import { nextExactDropAt, formatVN, parseTimeString } from "../../lib/drop_time";
import { scheduleTaskViaBackground } from "../../lib/scheduler_client";
import { MESSAGE_ACTIONS, SHOPEE_FLASH_HOURS } from "../../lib/constants";
import { isValidHttpUrl } from "../../lib/url";
import { Language, getTranslation } from "../../lib/i18n";

interface ScheduleFormProps {
  onTaskCreated: () => void;
  lang?: Language;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Calculates the next upcoming popular flash sale drop time in Vietnam (UTC+7).
 * Uses standardized SHOPEE_FLASH_HOURS [0, 9, 12, 15, 18, 21] (L3).
 */
function getNextSaleDrop(nowMs: number): { timeStr: string; label: string; hour: number } {
  const vnTime = new Date(nowMs + 7 * 3600 * 1000);
  const currH = vnTime.getUTCHours();
  const currM = vnTime.getUTCMinutes();
  const totalMinutes = currH * 60 + currM;

  const popularSaleHours = SHOPEE_FLASH_HOURS;
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
  const [isDaily, setIsDaily] = useState<boolean>(false);
  const [clickProfileMode, setClickProfileMode] = useState<ClickProfileMode>("adaptive");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string>("");
  const t = getTranslation(lang);

  useEffect(() => {
    storage.getSettings().then((s) => {
      if (s.clickProfileMode) setClickProfileMode(s.clickProfileMode);
    });
  }, []);

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

  // Parse time input into h, m, s with strict validation (L1)
  const parsedTime = useMemo(() => {
    return parseTimeString(timeInput);
  }, [timeInput]);

  // When this hunt will actually run in Vietnam time
  const runsAt = useMemo(() => {
    if (!parsedTime.valid) return "--:--:--";
    const at = nextExactDropAt(parsedTime.h, parsedTime.m, parsedTime.s, Date.now());
    const isSameDay =
      new Date(at + 7 * 3600 * 1000).getUTCDate() === new Date(Date.now() + 7 * 3600 * 1000).getUTCDate();
    const dayLabel = isSameDay ? t.today : t.tomorrow;
    return `${dayLabel} ${parsedTime.formatted}`;
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
          chrome.tabs.sendMessage(tabId, { action: MESSAGE_ACTIONS.ACTIVATE_HUD, pickTarget: true }, () => {
            if (chrome.runtime.lastError) {
              // Gracefully handle inactive or non-injectable tab (L5)
            }
          });
          window.close();
        }
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parsedTime.valid) return;

    let finalUrl = "";
    let finalLabel = "";
    let targetSnapshot: SavedPageTarget | undefined;

    if (targetMode === "current") {
      finalUrl = currentTabUrl;
      targetSnapshot = currentTabTarget || undefined;
      const targetName = targetSnapshot?.name || currentTabDomain;
      finalLabel = `${parsedTime.formatted} · ${targetName}`;
    } else if (targetMode === "saved") {
      targetSnapshot = savedTargets.find((t) => t.id === selectedSavedId);
      if (!targetSnapshot) return;
      finalUrl = targetSnapshot.url;
      finalLabel = `${parsedTime.formatted} · ${targetSnapshot.name}`;
    } else {
      finalUrl = customUrl.trim();
      if (!isValidHttpUrl(finalUrl)) return;
      // Only a button the user picked is ever clicked (decision 1): the page needs a saved target
      targetSnapshot = (await storage.getSavedTargetForUrl(finalUrl)) || undefined;
      let host = "Web";
      try {
        host = new URL(finalUrl).hostname.replace(/^www\./, "");
      } catch {
        // ignore
      }
      finalLabel = `${parsedTime.formatted} · ${host}`;
    }

    if (!targetSnapshot?.descriptor) {
      setFormError(t.scheduleNeedsTarget);
      return;
    }
    setFormError("");

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
        isDaily,
        savedTargetId: targetSnapshot?.id,
        descriptor: targetSnapshot?.descriptor,
        dualDefenseReload: targetSnapshot?.dualDefenseReload ?? true,
        diagnostics: targetSnapshot?.diagnostics,
        clickProfileMode,
        preWarmSeconds: 60, // Optimal autonomous pre-warm lead time
        status: "pending",
        createdAt: Date.now(),
      };

      await scheduleTaskViaBackground(newTask);
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
              className={`w-full rounded-lg bg-white/5 px-2.5 py-1 text-[11px] text-slate-100 ring-1 placeholder:text-slate-500 focus:outline-none focus:ring-1 font-mono ${
                customUrl.trim() && !isValidHttpUrl(customUrl.trim())
                  ? "ring-rose-500/50 focus:ring-rose-400"
                  : "ring-white/10 focus:ring-emerald-400"
              }`}
            />
            {customUrl.trim() && !isValidHttpUrl(customUrl.trim()) && (
              <span className="text-[9px] font-semibold text-rose-400">{t.invalidUrl}</span>
            )}
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
            className={`w-24 shrink-0 rounded-xl bg-black/40 px-2 py-1.5 text-center font-mono text-sm font-bold ring-1 outline-none focus:ring-2 ${
              !parsedTime.valid
                ? "text-rose-300 ring-rose-500/50 focus:ring-rose-400"
                : "text-emerald-300 ring-white/10 focus:ring-emerald-400"
            }`}
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
        {!parsedTime.valid && (
          <span className="text-[9px] font-semibold text-rose-400">{t.invalidTimeFormat}</span>
        )}
      </div>

      {/* Daily Repeat Switch */}
      <button
        type="button"
        role="switch"
        aria-checked={isDaily}
        onClick={() => setIsDaily(!isDaily)}
        className={`group flex w-full items-center justify-between rounded-xl px-3 py-2 transition text-left select-none ${
          isDaily
            ? "bg-emerald-500/10 ring-1 ring-emerald-500/30"
            : "bg-black/30 ring-1 ring-white/5 hover:bg-white/[0.02] hover:ring-white/10"
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0 pr-2">
          <div
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition ${
              isDaily
                ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40"
                : "bg-white/5 text-slate-400 ring-1 ring-white/10 group-hover:text-slate-300"
            }`}
          >
            <Repeat className="h-3.5 w-3.5" />
          </div>
          <div className="flex flex-col min-w-0">
            <span
              className={`text-[11px] font-semibold transition ${
                isDaily ? "text-emerald-300" : "text-slate-200 group-hover:text-white"
              }`}
            >
              {t.dailyScheduleCheckbox}
            </span>
            <span className="text-[9px] text-slate-400 truncate leading-tight">
              {t.dailyScheduleHint}
            </span>
          </div>
        </div>

        {/* Custom iOS-style toggle switch */}
        <div
          aria-hidden="true"
          className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out ${
            isDaily ? "bg-emerald-500 shadow-sm shadow-emerald-500/40" : "bg-slate-800 ring-1 ring-white/10"
          }`}
        >
          <span
            className={`inline-block h-3 w-3 transform rounded-full bg-white shadow-sm transition duration-200 ease-in-out ${
              isDaily ? "translate-x-[14px]" : "translate-x-0.5"
            }`}
          />
        </div>
      </button>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={
          submitting ||
          !parsedTime.valid ||
          (targetMode === "current" && (!currentTabUrl || !currentTabTarget)) ||
          (targetMode === "saved" && savedTargets.length === 0) ||
          (targetMode === "custom" && (!customUrl.trim() || !isValidHttpUrl(customUrl.trim())))
        }
        className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-2.5 text-[13px] font-bold text-slate-950 shadow-lg shadow-emerald-950/50 transition hover:from-emerald-400 hover:to-teal-400 disabled:opacity-50"
      >
        <Plus className="h-4 w-4" />
        {t.scheduleSubmitBtn(parsedTime.formatted)}
      </button>
      {formError && (
        <p role="alert" className="text-center text-[10px] font-semibold text-rose-400">
          {formError}
        </p>
      )}
    </form>
  );
};
