import React, { useState, useEffect } from "react";
import { Clock, RefreshCw, Wifi } from "lucide-react";
import { ClockCalibration } from "../../lib/types";
import { storage } from "../../lib/storage";
import { MESSAGE_ACTIONS } from "../../lib/constants";

export const TimeOffsetCard: React.FC = () => {
  const [calibration, setCalibration] = useState<ClockCalibration | null>(null);
  const [loading, setLoading] = useState(false);

  const loadCalibration = async () => {
    const cal = await storage.getCalibration();
    setCalibration(cal);
  };

  useEffect(() => {
    loadCalibration();
  }, []);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      const res = await chrome.runtime.sendMessage({
        action: MESSAGE_ACTIONS.CALIBRATE_TIME,
        samples: 5,
      });
      if (res && res.calibration) {
        setCalibration(res.calibration);
      }
    } finally {
      setLoading(false);
    }
  };

  const offset = calibration?.offsetMs ?? 0;
  const rtt = calibration?.rttMs ?? 0;

  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl p-3.5 shadow-2xs space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <div className="flex items-center gap-1.5 font-semibold text-slate-700">
          <Clock className="w-3.5 h-3.5 text-emerald-600" />
          <span>Dong Bo Gio Shopee</span>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          <span>Do lai</span>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 pt-0.5">
        <div className="bg-slate-50 rounded-xl p-2 border border-slate-100">
          <span className="text-[10px] text-slate-400 block font-medium">Do lech dong ho</span>
          <span className="font-mono text-sm font-bold text-slate-900">
            {offset >= 0 ? `+${offset}ms` : `${offset}ms`}
          </span>
        </div>

        <div className="bg-slate-50 rounded-xl p-2 border border-slate-100">
          <span className="text-[10px] text-slate-400 block font-medium">Do tre mang (RTT)</span>
          <div className="flex items-center gap-1">
            <Wifi className="w-3 h-3 text-emerald-600" />
            <span className="font-mono text-sm font-bold text-slate-900">{rtt}ms</span>
          </div>
        </div>
      </div>
    </div>
  );
};
