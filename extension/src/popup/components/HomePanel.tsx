import React, { useEffect, useState } from "react";
import { Crosshair, PanelRightOpen, ExternalLink, CalendarClock, ChevronRight, Globe, Check, Lightbulb } from "lucide-react";
import { ScheduledTask, SavedPageTarget } from "../../lib/types";
import { storage } from "../../lib/storage";
import { POPULAR_SHOPPING_HUBS } from "../../lib/constants";
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
  /** The site's icon, from the tab. */
  favIconUrl?: string;
  tasks: ScheduledTask[];
  onSeeAllHunts: () => void;
}

const pad = (n: number) => String(n).padStart(2, "0");
const taskTime = (task: ScheduledTask) => `${pad(task.targetHour)}:${pad(task.targetMinute)}:${pad(task.targetSecond ?? 0)}`;
const isUpcoming = (task: ScheduledTask) => task.status === "pending" || task.status === "running";
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Name of the button a task clicks, for display. */
export function taskButtonName(task: ScheduledTask, fallback: string): string {
  if (task.descriptor?.initialText?.trim()) return task.descriptor.initialText.trim();
  const fromLabel = task.label?.replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*·\s*/, "").trim();
  return fromLabel || fallback;
}

/** Where the open page stands in the 3 steps: 1 open the page (done), 2 pick a button, 3 set the time. */
export function pageStep(hasButton: boolean, hasHunt: boolean): 2 | 3 | 4 {
  if (!hasButton) return 2;
  return hasHunt ? 4 : 3;
}

/**
 * The popup's first screen, about the page that is open, with one main button:
 * - not a website: the 3 steps and quick links to open a shop
 * - a website: its 3-step progress (the guide is always there, and always about this page),
 *   then "Pick a button" or "Open hunt panel"
 * Below: the next hunt elsewhere, and a short tip.
 */
export const HomePanel: React.FC<HomePanelProps> = ({ lang, activeTabId, activeUrl, activeDomain, favIconUrl, tasks, onSeeAllHunts }) => {
  const t = getTranslation(lang);
  const [saved, setSaved] = useState<SavedPageTarget | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [iconFailed, setIconFailed] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [now, setNow] = useState(Date.now());
  const onWeb = isWebUrl(activeUrl);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setSaved(null);
    setLoaded(false);
    setIconFailed(false);
    if (!onWeb) return;
    storage
      .getSavedTargetForUrl(activeUrl)
      .then(setSaved)
      .catch(() => setSaved(null))
      .finally(() => setLoaded(true));
  }, [activeUrl]);

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

  const upcoming = tasks.filter(isUpcoming).sort((a, b) => (a.targetAt ?? Infinity) - (b.targetAt ?? Infinity));
  const pageTask = onWeb ? upcoming.find((task) => isSamePageUrl(task.targetUrl, activeUrl)) : undefined;
  const next = upcoming.find((task) => task !== pageTask);
  const step = pageStep(Boolean(saved), Boolean(pageTask));
  const steps = [t.onboardingStep1, t.onboardingStep2, t.onboardingStep3];

  const stepper = (current: number) => (
    <ol className="space-y-1.5">
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <li key={n} className="flex items-center gap-2.5 text-[12px]">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                done ? "bg-emerald-500 text-slate-950" : active ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/60" : "bg-white/5 text-slate-500"
              }`}
            >
              {done ? <Check className="h-3 w-3" /> : n}
            </span>
            <span className={done ? "text-slate-400" : active ? "font-semibold text-white" : "text-slate-400"}>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );

  const tip = !onWeb ? t.tipOpenShop : !saved ? t.tipPickButton : pageTask ? t.tipKeepOpen : t.tipTestFirst;

  return (
    <div className="flex min-h-full flex-col gap-3">
      {!onWeb ? (
        <section className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/5 ring-1 ring-white/10">
              <Globe className="h-5 w-5 text-slate-300" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold text-white">{t.homeNoPageTitle}</h2>
              <p className="truncate text-[11px] text-slate-400">
                {!activeUrl || /^(chrome|edge|brave):\/\/newtab|^about:blank/i.test(activeUrl) ? t.homeNoPageText : t.homeCannotRun}
              </p>
            </div>
          </div>
          <div className="mt-3.5 rounded-xl bg-black/25 p-3 ring-1 ring-white/[0.06]">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t.onboardingTitle}</p>
            {stepper(1)}
          </div>
          <p className="mt-3.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t.homeQuickOpen}</p>
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
      ) : (
        <section className="rounded-2xl bg-gradient-to-br from-emerald-950/60 via-black/40 to-black/60 p-4 ring-1 ring-emerald-500/25">
          {/* The page */}
          <div className="flex items-center gap-2">
            {favIconUrl && !iconFailed ? (
              <img src={favIconUrl} alt="" onError={() => setIconFailed(true)} className="h-5 w-5 rounded" />
            ) : (
              <Globe className="h-5 w-5 text-emerald-300" />
            )}
            <span className="truncate text-[13px] font-semibold text-emerald-200">{activeDomain}</span>
          </div>

          {/* Where this page stands */}
          <div className={`mt-3 rounded-xl bg-black/25 p-3 ring-1 ring-white/[0.06] ${loaded ? "" : "opacity-0"}`}>
            {stepper(step)}
            {saved && (
              <p className="mt-2.5 truncate border-t border-white/[0.06] pt-2 text-[12px] text-slate-300" title={saved.name}>
                {t.homeReadyButton(saved.name)}
                {pageTask && <span className="text-slate-500"> · {t.homeScheduledAt(taskTime(pageTask).slice(0, 5), Boolean(pageTask.isDaily))}</span>}
              </p>
            )}
          </div>

          {/* One main action */}
          <button
            type="button"
            onClick={() => open(!saved)}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-3 text-[14px] font-bold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:brightness-110 active:scale-[0.99]"
          >
            {saved ? <PanelRightOpen className="h-5 w-5" /> : <Crosshair className="h-5 w-5" />}
            {saved ? t.homeOpenPanelCta : t.homePickCta}
          </button>
          <div className="mt-2 flex h-5 items-center justify-center">
            {saved ? (
              <button type="button" onClick={() => open(true)} className="text-[12px] font-semibold text-slate-400 hover:text-emerald-300">
                {t.homeRepick}
              </button>
            ) : (
              <span className="text-[12px] text-slate-500">{t.homePickText(activeDomain)}</span>
            )}
          </div>
          {(saved || pageTask) && (
            <div className="mt-1 border-t border-white/[0.06] pt-2">
              <ClockStatus lang={lang} activeUrl={activeUrl} activeDomain={activeDomain} />
            </div>
          )}
        </section>
      )}

      {next && (
        <button
          type="button"
          onClick={onSeeAllHunts}
          className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.03] px-3.5 py-3 text-left ring-1 ring-white/[0.08] transition hover:bg-white/[0.06]"
        >
          <span className="flex flex-col items-center">
            <CalendarClock className="mb-0.5 h-3.5 w-3.5 text-emerald-400" />
            <span className="font-mono text-[15px] font-bold text-emerald-300">{taskTime(next).slice(0, 5)}</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t.homeNextHuntLabel}</span>
            <span className="block truncate text-[13px] font-semibold text-slate-100">{taskButtonName(next, t.targetButtonDefault)}</span>
            <span className="block truncate text-[11px] text-slate-500">
              {hostOf(next.targetUrl)}
              {next.targetAt ? ` · ${t.homeTimeLeft(formatTimeLeft(next.targetAt - now, t))}` : ""}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
        </button>
      )}

      {/* A short tip that fits where the user is */}
      <p className="mt-auto flex items-start gap-2 rounded-xl bg-white/[0.02] px-3 py-2.5 text-[11px] leading-snug text-slate-400 ring-1 ring-white/[0.05]">
        <Lightbulb className="mt-px h-3.5 w-3.5 shrink-0 text-amber-300/80" />
        <span>{tip}</span>
      </p>

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
    </div>
  );
};
