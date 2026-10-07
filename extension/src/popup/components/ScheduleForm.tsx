import React, { useState } from "react";
import { Plus, Zap, Calendar, ExternalLink } from "lucide-react";
import { ScheduledTask } from "../../lib/types";
import { SHOPEE_FLASH_HOURS, SHOPEE_URLS } from "../../lib/constants";
import { taskScheduler } from "../../background/scheduler";

interface ScheduleFormProps {
  onTaskCreated: () => void;
}

export const ScheduleForm: React.FC<ScheduleFormProps> = ({ onTaskCreated }) => {
  const [targetHour, setTargetHour] = useState<number>(0);
  const [targetUrl, setTargetUrl] = useState<string>(SHOPEE_URLS.VOUCHER_HUB);
  const [label, setLabel] = useState<string>("San ma 0h Shopee");
  const [keyword, setKeyword] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const newTask: ScheduledTask = {
        id: Math.random().toString(36).substring(2, 9),
        targetHour,
        targetMinute: 0,
        targetUrl,
        label: label.trim() || `San ma ${targetHour}h`,
        mode: "full_auto", // a scheduled hunt always runs unattended
        keyword: keyword.trim() || undefined,
        status: "pending",
        createdAt: Date.now(),
      };

      await taskScheduler.scheduleTask(newTask);
      onTaskCreated();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs space-y-3.5">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-black text-slate-900 tracking-tight flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-emerald-600" />
          <span>Hen Gio San Voucher</span>
        </h3>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200">
          Tu dong 100%
        </span>
      </div>

      {/* Target Hour Picker */}
      <div className="space-y-1">
        <label className="text-[11px] font-semibold text-slate-500">Khung gio san ma</label>
        <div className="grid grid-cols-6 gap-1">
          {SHOPEE_FLASH_HOURS.map((hour) => (
            <button
              key={hour}
              type="button"
              onClick={() => setTargetHour(hour)}
              className={`py-1.5 rounded-xl text-xs font-bold transition-all border ${
                targetHour === hour
                  ? "bg-emerald-600 text-white border-emerald-600 shadow-2xs"
                  : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
              }`}
            >
              {hour}h
            </button>
          ))}
        </div>
      </div>

      {/* Target URL */}
      <div className="space-y-1">
        <label className="text-[11px] font-semibold text-slate-500">Trang Shopee muc tieu</label>
        <select
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        >
          <option value={SHOPEE_URLS.VOUCHER_HUB}>Hub Ma Giam Gia (shopee.vn/m/ma-giam-gia)</option>
          <option value={SHOPEE_URLS.SUPER_SALE_1010}>Sieu Sale 10/10 (shopee.vn/m/10-10)</option>
          <option value={SHOPEE_URLS.CART}>Gio Hang San San (shopee.vn/cart)</option>
        </select>
      </div>

      {/* Keyword Filter (Optional) */}
      <div className="space-y-1">
        <label className="text-[11px] font-semibold text-slate-500">
          Tu khoa voucher <span className="font-normal text-slate-400">(tuy chon: 500k, 15%, freeship)</span>
        </label>
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="Vi du: 15% hoac 500k"
          className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
      >
        <Plus className="w-3.5 h-3.5" />
        <span>Dat Lich San Ma {targetHour}h00</span>
      </button>
    </form>
  );
};
