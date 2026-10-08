import React, { useState, useEffect } from "react";
import { Clock, RefreshCw } from "lucide-react";
import { ClockCalibration } from "../../lib/types";
import { storage } from "../../lib/storage";
import { MESSAGE_ACTIONS } from "../../lib/constants";
import { Language, getTranslation } from "../../lib/i18n";

interface TimeOffsetCardProps {
  lang?: Language;
}

export const TimeOffsetCard: React.FC<TimeOffsetCardProps> = ({ lang = "en" }) => {
  const [calibration, setCalibration] = useState<ClockCalibration | null>(null);
  const [loading, setLoading] = useState(false);
  const t = getTranslation(lang);

  useEffect(() => {
    storage.getCalibration().then(setCalibration);
  }, []);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      const res = await chrome.runtime.sendMessage({ action: MESSAGE_ACTIONS.CALIBRATE_TIME, samples: 5 });
      if (res?.calibration) setCalibration(res.calibration);
    } finally {
      setLoading(false);
    }
  };

  const synced = !!calibration?.calibrated;
  const offset = calibration?.offsetMs ?? 0;
  const ageMin = calibration ? Math.round((Date.now() - calibration.lastCalibratedAt) / 60000) : null;
  const syncAgeText =
    ageMin === null
      ? t.neverSynced
      : ageMin === 0
      ? t.syncedJustNow
      : t.syncedMinAgo(ageMin);

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <Clock className="h-3.5 w-3.5" />
          </div>
          <div className="leading-tight">
            <h2 className="text-[13px] font-semibold text-slate-900">{t.clockSyncTitle}</h2>
            <p className="text-[10px] text-slate-400">{syncAgeText}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-1 rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          {loading ? t.syncing : t.resync}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
          <span className="block text-[10px] font-medium text-slate-400">{t.offsetVsShopee}</span>
          {synced ? (
            <span className="font-mono text-sm font-bold tabular-nums text-slate-900">
              {offset >= 0 ? "+" : ""}
              {offset} ms
              <span className="ml-1 text-[10px] font-semibold text-slate-400">±{calibration!.errorMs}</span>
            </span>
          ) : (
            <span className="text-[12px] font-semibold text-rose-600">{t.notSynced}</span>
          )}
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
          <span className="block text-[10px] font-medium text-slate-400">{t.roundTrip}</span>
          <span className="font-mono text-sm font-bold tabular-nums text-slate-900">
            {calibration ? `${calibration.rttMs} ms` : "—"}
          </span>
        </div>
      </div>
    </section>
  );
};
