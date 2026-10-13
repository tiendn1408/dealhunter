import React, { useEffect, useState } from "react";
import { Crosshair, PanelRightOpen, ExternalLink, Sparkles, X, CalendarClock, ChevronRight, Globe } from "lucide-react";
import { ScheduledTask, SavedPageTarget } from "../../lib/types";
import { storage } from "../../lib/storage";
import { POPULAR_SHOPPING_HUBS, STORAGE_KEYS } from "../../lib/constants";
import { isSamePageUrl } from "../../lib/url";
import { formatTimeLeft } from "../../lib/drop_time";
import { Language, getTranslation } from "../../lib/i18n";
import { openHuntPanel, isWebUrl } from "../page_actions";
import { ClockStatus } from "./TimeOffsetCard";

interface HomePanelProps {
  lang: Language;
  activeTabId: number | null;
  activeUrl: string;
  activeDomain: string;
  tasks: ScheduledTask[];
  onSeeAllHunts: () => void;
}

const pad = (n: number) => String(n).padStart(2, "0");
const taskTime = (task: ScheduledTask) => `${pad(task.targetHour)}:${pad(task.targetMinute)}:${pad(task.targetSecond ?? 0)}`;
const isUpcoming = (task: ScheduledTask) => task.status === "pending" || task.status === "running";

/**
 * Whether to show the 3-step guide. flag: undefined (never decided), true (done / dismissed) or
 * "again" (asked for from the settings).
 */
export function shouldShowGuide(flag: unknown, hasProgress: boolean): boolean {
  if (flag === "again") return true;
  if (flag === true) return false;
  return !hasProgress;
}

/** Name of the button a task clicks, for display. */
export function taskButtonName(task: ScheduledTask, fallback: string): string {
  if (task.descriptor?.initialText?.trim()) return task.descriptor.initialText.trim();
  const fromLabel = task.label?.replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*·\s*/, "").trim();
  return fromLabel || fallback;
}

/**
 * The popup's first screen: what to do next on the page that is open, in one button.
 * - not a website: open one (quick links)
 * - no button chosen here: "Pick a button on the page" (opens the panel in pick mode)
 * - a button is remembered here: "Open the hunt panel", with the scheduled time if any
 * Plus a 3-step guide the first time, and the next hunts coming up.
 */
export const HomePanel: React.FC<HomePanelProps> = ({ lang, activeTabId, activeUrl, activeDomain, tasks, onSeeAllHunts }) => {
  const t = getTranslation(lang);
  const [saved, setSaved] = useState<SavedPageTarget | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [now, setNow] = useState(Date.now());
  const onWeb = isWebUrl(activeUrl);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // The guide is for someone who has not done the steps yet: once a button was picked (or a hunt
  // scheduled) it goes away for good, unless asked for again from the settings.
  useEffect(() => {
    (async () => {
      const flag = (await chrome.storage.local.get(STORAGE_KEYS.ONBOARDING_DONE))[STORAGE_KEYS.ONBOARDING_DONE];
      const hasProgress = (await storage.getSavedPageTargets()).length > 0 || tasks.length > 0;
      const show = shouldShowGuide(flag, hasProgress);
      setShowGuide(show);
      if (!show && flag === undefined && hasProgress) {
        await chrome.storage.local.set({ [STORAGE_KEYS.ONBOARDING_DONE]: true });
      }
    })().catch(() => setShowGuide(false));
  }, [tasks.length]);

  useEffect(() => {
    setSaved(null);
    if (onWeb) storage.getSavedTargetForUrl(activeUrl).then(setSaved).catch(() => setSaved(null));
  }, [activeUrl]);

  const dismissGuide = () => {
    setShowGuide(false);
    chrome.storage.local.set({ [STORAGE_KEYS.ONBOARDING_DONE]: true }).catch(() => {});
  };

  const open = async (pick: boolean) => {
    if (!activeTabId) return;
    const ok = await openHuntPanel(activeTabId, pick);
    if (ok) {
      setNotice({ text: t.homePanelOpened, tone: "ok" });
      setTimeout(() => window.close(), 500);
    } else {
      setNotice({ text: t.homeCannotRun, tone: "error" });
    }
  };

  const upcoming = tasks
    .filter(isUpcoming)
    .sort((a, b) => (a.targetAt ?? Infinity) - (b.targetAt ?? Infinity));
  const pageTask = onWeb ? upcoming.find((task) => isSamePageUrl(task.targetUrl, activeUrl)) : undefined;
  const others = upcoming.filter((task) => task !== pageTask);

  return (
    <div className="space-y-3">
      {showGuide && (
        <section className="relative rounded-2xl bg-gradient-to-br from-emerald-500/15 via-teal-500/5 to-transparent p-3.5 ring-1 ring-emerald-500/30">
          <button
            type="button"
            onClick={dismissGuide}
            aria-label={t.onboardingDismiss}
            className="absolute right-2.5 top-2.5 rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <h2 className="flex items-center gap-1.5 text-[13px] font-bold text-emerald-200">
            <Sparkles className="h-4 w-4" />
            {t.onboardingTitle}
          </h2>
          <ol className="mt-2.5 space-y-2">
            {[t.onboardingStep1, t.onboardingStep2, t.onboardingStep3].map((step, i) => (
              <li key={i} className="flex gap-2.5 text-[12px] leading-snug text-slate-200">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-slate-950">
                  {i + 1}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={dismissGuide}
            className="mt-3 w-full rounded-xl bg-white/10 py-2 text-[12px] font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15"
          >
            {t.onboardingDismiss}
          </button>
        </section>
      )}

      {/* What to do on the page that is open */}
      {!onWeb ? (
        <section className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/5 ring-1 ring-white/10">
              <Globe className="h-5 w-5 text-slate-300" />
            </div>
            <h2 className="text-[15px] font-bold text-white">{t.homeNoPageTitle}</h2>
          </div>
          {/* A new / empty tab just needs a page; other browser pages cannot be used at all */}
          <p className="mt-2 text-[12px] leading-relaxed text-slate-400">
            {!activeUrl || /^(chrome|edge|brave):\/\/newtab|^about:blank/i.test(activeUrl) ? t.homeNoPageText : t.homeCannotRun}
          </p>
          <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t.homeQuickOpen}</p>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            {POPULAR_SHOPPING_HUBS.map((hub) => (
              <button
                key={hub.name}
                type="button"
                onClick={async () => {
                  await chrome.tabs.create({ url: hub.url });
                  window.close();
                }}
                className="flex items-center justify-between rounded-xl bg-black/30 px-3 py-2 text-[12px] font-semibold text-slate-200 ring-1 ring-white/10 transition hover:bg-white/10"
              >
                {hub.name}
                <ExternalLink className="h-3 w-3 text-slate-500" />
              </button>
            ))}
          </div>
        </section>
      ) : saved ? (
        <section className="rounded-2xl bg-gradient-to-br from-emerald-950/60 via-black/40 to-black/60 p-4 ring-1 ring-emerald-500/25">
          <p className="text-[11px] font-semibold text-emerald-300">{activeDomain}</p>
          <h2 className="mt-0.5 text-[15px] font-bold text-white">{t.homeReadyTitle}</h2>
          <p className="mt-1.5 truncate text-[12px] text-slate-300" title={saved.name}>
            {t.homeReadyButton(saved.name)}
          </p>
          {pageTask && (
            <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl bg-black/30 px-3 py-2 ring-1 ring-white/10">
              <span className="flex items-center gap-1.5 text-[12px] text-slate-200">
                <CalendarClock className="h-3.5 w-3.5 text-emerald-400" />
                {t.homeScheduledAt(taskTime(pageTask), Boolean(pageTask.isDaily))}
              </span>
              {pageTask.targetAt && (
                <span className="shrink-0 text-[11px] font-semibold text-amber-300">
                  {t.homeTimeLeft(formatTimeLeft(pageTask.targetAt - now, t))}
                </span>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => open(false)}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-3 text-[14px] font-bold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:brightness-110 active:scale-[0.99]"
          >
            <PanelRightOpen className="h-5 w-5" />
            {t.homeOpenPanelCta}
          </button>
          <button
            type="button"
            onClick={() => open(true)}
            className="mt-2 w-full text-center text-[12px] font-semibold text-slate-400 hover:text-emerald-300"
          >
            {t.homeRepick}
          </button>
        </section>
      ) : (
        <section className="rounded-2xl bg-gradient-to-br from-emerald-950/60 via-black/40 to-black/60 p-4 ring-1 ring-emerald-500/25">
          <p className="text-[11px] font-semibold text-emerald-300">{activeDomain}</p>
          <h2 className="mt-0.5 text-[15px] font-bold text-white">{t.homePickTitle}</h2>
          <p className="mt-1.5 text-[12px] leading-relaxed text-slate-300">{t.homePickText(activeDomain)}</p>
          <button
            type="button"
            onClick={() => open(true)}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-3 text-[14px] font-bold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:brightness-110 active:scale-[0.99]"
          >
            <Crosshair className="h-5 w-5" />
            {t.homePickCta}
          </button>
        </section>
      )}

      {/* Floating at the bottom of the popup: showing it moves nothing */}
      {notice && (
        <div
          role="status"
          className={`absolute inset-x-3 bottom-3 z-40 rounded-xl px-3 py-2.5 text-center text-[12px] font-semibold shadow-2xl ring-1 ${
            notice.tone === "ok" ? "bg-emerald-950 text-emerald-200 ring-emerald-500/40" : "bg-amber-950 text-amber-200 ring-amber-500/40"
          }`}
        >
          {notice.text}
        </div>
      )}

      {onWeb && <ClockStatus lang={lang} activeUrl={activeUrl} activeDomain={activeDomain} />}

      {/* The next hunt elsewhere, in one line (the full list is the "My hunts" tab) */}
      {others[0] && (
        <button
          type="button"
          onClick={onSeeAllHunts}
          className="flex w-full items-center gap-2 rounded-xl bg-white/[0.03] px-3 py-2.5 text-left ring-1 ring-white/[0.06] transition hover:bg-white/[0.06]"
        >
          <CalendarClock className="h-4 w-4 shrink-0 text-emerald-400" />
          <span className="min-w-0 flex-1 truncate text-[12px] text-slate-300">
            {t.homeNextHunt(taskTime(others[0]).slice(0, 5), taskButtonName(others[0], t.targetButtonDefault))}
          </span>
          {others[0].targetAt && (
            <span className="shrink-0 text-[11px] text-slate-500">{t.homeTimeLeft(formatTimeLeft(others[0].targetAt - now, t))}</span>
          )}
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        </button>
      )}
    </div>
  );
};
