import React, { useState, useEffect } from "react";
import { Clock, RefreshCw } from "lucide-react";
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

interface TimeOffsetCardProps {
  lang?: Language;
  activeDomain?: string;
  activeUrl?: string;
}

export const TimeOffsetCard: React.FC<TimeOffsetCardProps> = ({
  lang = "en",
  activeDomain,
  activeUrl,
}) => {
  const [calibration, setCalibration] = useState<ClockCalibration | null>(null);
  const [loading, setLoading] = useState(false);
  const t = getTranslation(lang);

  const cleanDomain = (activeDomain || "").replace(/^www\./, "").toLowerCase();

  const handleRefresh = async () => {
    setLoading(true);
    try {
      let pingUrl: string | undefined;
      if (activeUrl && (activeUrl.startsWith("http://") || activeUrl.startsWith("https://"))) {
        try {
          pingUrl = `${new URL(activeUrl).origin}/favicon.ico`;
        } catch {
          // ignore
        }
      }
      const res = await chrome.runtime.sendMessage({
        action: MESSAGE_ACTIONS.CALIBRATE_TIME,
        samples: 5,
        targetUrl: pingUrl,
      });
      if (res?.calibration) setCalibration(res.calibration);
    } finally {
      setLoading(false);
    }
  };

  // Decision 2: the clock is measured only for a page that is hunted. Opening the popup on such a
  // page (saved button or scheduled task) measures it when needed; on any other page nothing is
  // probed and the card just says it will be measured when hunting there.
  const [pageIsHunted, setPageIsHunted] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setPageIsHunted(false);
    if (!cleanDomain) {
      setCalibration(null);
      return;
    }
    (async () => {
      const [cal, hunted] = await Promise.all([
        storage.getCalibration(cleanDomain).catch(() => null),
        activeUrl ? isHuntedPage(activeUrl).catch(() => false) : Promise.resolve(false),
      ]);
      if (cancelled) return;
      setCalibration(cal);
      setPageIsHunted(hunted);
      if (hunted && shouldAutoSync(cal, Date.now())) handleRefresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [cleanDomain, activeUrl]);

  const synced = !!calibration?.calibrated;
  const offset = calibration?.offsetMs ?? 0;
  const ageMin = calibration ? Math.round((Date.now() - calibration.lastCalibratedAt) / 60000) : null;
  // Never measured and not hunted here: nothing is wrong, it is simply not needed yet
  const idle = !calibration && !pageIsHunted && !loading;
  const syncAgeText = idle
    ? t.syncWhenHunting
    : ageMin === null
      ? t.neverSynced
      : ageMin === 0
      ? t.syncedJustNow
      : t.syncedMinAgo(ageMin);

  const targetHostName = activeDomain || calibration?.serverHost || "";
  const offsetLabel = t.offsetVsDomain ? t.offsetVsDomain(targetHostName) : t.offsetVsShopee;

  return (
    <section className="rounded-2xl bg-white/[0.03] p-3.5 ring-1 ring-white/10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20">
            <Clock className="h-3.5 w-3.5" />
          </div>
          <div className="leading-tight">
            <h2 className="text-[13px] font-semibold text-slate-100">{t.clockSyncTitle}</h2>
            <p className="text-[10px] text-slate-400">{syncAgeText}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-slate-200 ring-1 ring-white/15 transition hover:bg-white/15 disabled:opacity-60"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          {loading ? t.syncing : t.resync}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-black/40 px-3 py-2 ring-1 ring-white/5">
          <span className="block truncate text-[10px] font-medium text-slate-400" title={offsetLabel}>
            {offsetLabel}
          </span>
          {synced ? (
            <span className="font-mono text-sm font-bold tabular-nums text-emerald-400">
              {offset >= 0 ? "+" : ""}
              {offset} ms
              <span className="ml-1 text-[10px] font-semibold text-slate-400">±{calibration!.errorMs}</span>
            </span>
          ) : idle ? (
            <span className="text-[12px] font-semibold text-slate-400">{t.notNeededYet}</span>
          ) : (
            <span className="text-[12px] font-semibold text-rose-400">{t.notSynced}</span>
          )}
        </div>
        <div className="rounded-xl bg-black/40 px-3 py-2 ring-1 ring-white/5">
          <span className="block text-[10px] font-medium text-slate-400">{t.roundTrip}</span>
          <span className="font-mono text-sm font-bold tabular-nums text-slate-200">
            {calibration ? `${calibration.rttMs} ms` : "—"}
          </span>
        </div>
      </div>
    </section>
  );
};
