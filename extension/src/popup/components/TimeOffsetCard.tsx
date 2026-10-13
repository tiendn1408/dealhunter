import React, { useEffect, useState } from "react";
import { CircleCheck, Loader2, Clock } from "lucide-react";
import { ClockCalibration } from "../../lib/types";
import { storage } from "../../lib/storage";
import { MESSAGE_ACTIONS } from "../../lib/constants";
import { isSamePageUrl } from "../../lib/url";
import { Language, getTranslation } from "../../lib/i18n";

/** Re-measure a hunted page whose clock was never measured, failed, or is older than this. */
const MAX_CALIBRATION_AGE_MS = 5 * 60 * 1000;

export function shouldAutoSync(cal: ClockCalibration | null, now: number): boolean {
  return !cal || !cal.calibrated || now - cal.lastCalibratedAt > MAX_CALIBRATION_AGE_MS;
}

/** The page has a saved button or a scheduled task that is not finished. */
export async function isHuntedPage(url: string): Promise<boolean> {
  if (await storage.getSavedTargetForUrl(url)) return true;
  const tasks = await storage.getTasks();
  return tasks.some((t) => (t.status === "pending" || t.status === "running") && isSamePageUrl(t.targetUrl, url));
}

interface ClockStatusProps {
  lang: Language;
  activeUrl: string;
  activeDomain: string;
  /** Short labels, right-aligned (the full sentence is the tooltip). */
  compact?: boolean;
}

/**
 * One plain-language line about the clock, only on a page that is hunted (decision 2: other pages
 * are never probed and need no clock talk). Offsets and round trips are internal details.
 */
export const ClockStatus: React.FC<ClockStatusProps> = ({ lang, activeUrl, activeDomain, compact = false }) => {
  const t = getTranslation(lang);
  const [state, setState] = useState<"hidden" | "checking" | "ready" | "failed">("hidden");
  const domain = activeDomain.replace(/^www\./, "").toLowerCase();

  const measure = async () => {
    setState("checking");
    try {
      const res = await chrome.runtime.sendMessage({
        action: MESSAGE_ACTIONS.CALIBRATE_TIME,
        samples: 3,
        targetUrl: `${new URL(activeUrl).origin}/favicon.ico`,
      });
      setState(res?.calibration?.calibrated ? "ready" : "failed");
    } catch {
      setState("failed");
    }
  };

  useEffect(() => {
    let cancelled = false;
    setState("hidden");
    if (!domain || !activeUrl) return;
    (async () => {
      const [cal, hunted] = await Promise.all([
        storage.getCalibration(domain).catch(() => null),
        isHuntedPage(activeUrl).catch(() => false),
      ]);
      if (cancelled || !hunted) return;
      if (shouldAutoSync(cal, Date.now())) measure();
      else setState("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [domain, activeUrl]);

  // Same height whether shown or not (it appears a moment after the popup opens)
  if (state === "hidden") return <div className="h-4" aria-hidden="true" />;
  if (compact) {
    const full = state === "ready" ? t.clockReady(domain) : state === "checking" ? t.clockChecking : t.clockFailed;
    return (
      <button
        type="button"
        onClick={state === "failed" ? measure : undefined}
        title={full}
        className="flex h-4 min-w-0 items-center gap-1 text-[11px] text-slate-400"
      >
        {state === "checking" && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
        {state === "ready" && <CircleCheck className="h-3 w-3 shrink-0 text-emerald-400" />}
        {state === "failed" && <Clock className="h-3 w-3 shrink-0 text-slate-500" />}
        <span className="truncate">{state === "ready" ? t.clockShortReady : state === "checking" ? t.clockChecking : t.clockShortFailed}</span>
      </button>
    );
  }
  return (
    <div className="flex h-4 items-center gap-1.5 px-1 text-[11px]">
      {state === "checking" && (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
          <span className="text-slate-400">{t.clockChecking}</span>
        </>
      )}
      {state === "ready" && (
        <>
          <CircleCheck className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-slate-300">{t.clockReady(domain)}</span>
        </>
      )}
      {state === "failed" && (
        <>
          <Clock className="h-3.5 w-3.5 text-slate-500" />
          <span className="flex-1 truncate text-slate-400">{t.clockFailed}</span>
          <button type="button" onClick={measure} className="shrink-0 text-slate-400 hover:text-emerald-300 hover:underline">
            {t.clockRetry}
          </button>
        </>
      )}
    </div>
  );
};
