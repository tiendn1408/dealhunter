import React, { useMemo, useState } from "react";
import { CalendarClock, Plus } from "lucide-react";
import { ScheduledTask } from "../../lib/types";
import { SHOPEE_FLASH_HOURS, SHOPEE_URLS } from "../../lib/constants";
import { nextDropAt, nextFlashDrop, formatVN } from "../../lib/drop_time";
import { taskScheduler } from "../../background/scheduler";
import { Language, getTranslation } from "../../lib/i18n";

interface ScheduleFormProps {
  onTaskCreated: () => void;
  lang?: Language;
}

const pad = (n: number) => String(n).padStart(2, "0");

export const ScheduleForm: React.FC<ScheduleFormProps> = ({ onTaskCreated, lang = "en" }) => {
  const [targetHour, setTargetHour] = useState<number>(() => nextFlashDrop(SHOPEE_FLASH_HOURS, Date.now()).hour);
  const [targetUrl, setTargetUrl] = useState<string>(SHOPEE_URLS.VOUCHER_HUB);
  const [keyword, setKeyword] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const t = getTranslation(lang);

  const targetPages = [
    { url: SHOPEE_URLS.VOUCHER_HUB, label: t.voucherHub, hint: "shopee.vn/m/ma-giam-gia" },
    { url: SHOPEE_URLS.SUPER_SALE_1010, label: t.superSale1010, hint: "shopee.vn/m/10-10" },
    { url: SHOPEE_URLS.CART, label: t.cartPage, hint: "shopee.vn/cart" },
  ];

  // When this hunt will actually run, in Vietnam time
  const runsAt = useMemo(() => {
    const at = nextDropAt(targetHour, 0, Date.now(), 0);
    const today = formatVN(Date.now()).slice(0, 2) <= formatVN(at).slice(0, 2) && at - Date.now() < 24 * 3600 * 1000;
    const sameDay = new Date(at + 7 * 3600 * 1000).getUTCDate() === new Date(Date.now() + 7 * 3600 * 1000).getUTCDate();
    return `${sameDay && today ? t.today : t.tomorrow} ${pad(targetHour)}:00`;
  }, [targetHour, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const page = targetPages.find((p) => p.url === targetUrl);
      const newTask: ScheduledTask = {
        id: Math.random().toString(36).substring(2, 9),
        targetHour,
        targetMinute: 0,
        targetUrl,
        label: `${pad(targetHour)}:00 · ${page?.label ?? "Shopee"}`,
        mode: "full_auto", // a scheduled hunt always runs unattended
        keyword: keyword.trim() || undefined,
        status: "pending",
        createdAt: Date.now(),
      };
      await taskScheduler.scheduleTask(newTask);
      setKeyword("");
      onTaskCreated();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3.5 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <CalendarClock className="h-3.5 w-3.5" />
          </div>
          <div className="leading-tight">
            <h2 className="text-[13px] font-semibold text-slate-900">{t.scheduleTitle}</h2>
            <p className="text-[10px] text-slate-400">{t.scheduleSubtitle}</p>
          </div>
        </div>
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 ring-1 ring-indigo-100">
          {t.fullyAutomatic}
        </span>
      </div>

      {/* Drop time */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-semibold text-slate-600">{t.dropTimeLabel}</label>
          <span className="text-[10px] font-medium text-slate-400">{runsAt}</span>
        </div>
        <div className="grid grid-cols-6 gap-1.5">
          {SHOPEE_FLASH_HOURS.map((hour) => (
            <button
              key={hour}
              type="button"
              onClick={() => setTargetHour(hour)}
              className={`rounded-xl py-2 text-xs font-bold tabular-nums transition ${
                targetHour === hour
                  ? "bg-slate-900 text-white shadow-sm"
                  : "bg-slate-50 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
              }`}
            >
              {pad(hour)}
            </button>
          ))}
        </div>
      </div>

      {/* Target page */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-semibold text-slate-600">{t.targetPageLabel}</label>
        <div className="grid grid-cols-3 gap-1.5">
          {targetPages.map((p) => (
            <button
              key={p.url}
              type="button"
              onClick={() => setTargetUrl(p.url)}
              title={p.hint}
              className={`rounded-xl px-2 py-2 text-[11px] font-semibold transition ${
                targetUrl === p.url
                  ? "bg-emerald-50 text-emerald-800 ring-2 ring-emerald-500"
                  : "bg-slate-50 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Keyword */}
      <div className="space-y-1.5">
        <label className="flex items-center justify-between text-[11px] font-semibold text-slate-600">
          {t.keywordLabel}
          <span className="font-normal text-slate-400">{t.recommended}</span>
        </label>
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={t.keywordPlaceholder}
          className="w-full rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-800 ring-1 ring-slate-200 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <p className="text-[10px] leading-snug text-slate-400">
          {t.keywordHint}
        </p>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-2.5 text-[13px] font-bold text-white shadow-md shadow-emerald-600/20 transition hover:from-emerald-400 hover:to-teal-400 disabled:opacity-60"
      >
        <Plus className="h-4 w-4" />
        {t.scheduleButton(pad(targetHour))}
      </button>
    </form>
  );
};
