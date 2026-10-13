import React, { useEffect, useMemo, useState } from "react";
import { CalendarClock, Repeat, CheckCircle2, Crosshair, RefreshCw, Plus, Link2, ChevronLeft, ChevronRight } from "lucide-react";
import { ScheduledTask, SavedPageTarget } from "../../lib/types";
import { storage } from "../../lib/storage";
import { nextExactDropAt, parseTimeString, formatTimeLeft } from "../../lib/drop_time";
import { scheduleTaskViaBackground, updateTaskViaBackground, openAndPickViaBackground } from "../../lib/scheduler_client";
import { isSamePageUrl, isValidHttpUrl } from "../../lib/url";
import { Language, getTranslation } from "../../lib/i18n";

interface ScheduleFormProps {
  onTaskCreated: () => void;
  lang?: Language;
  /** Preselects the saved button of this page. */
  activeUrl?: string;
  /** Editing an existing hunt instead of creating one. */
  editing?: ScheduledTask | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/**
 * Adds a new button to hunt: on the page that is open, or on another page by its link. The extension
 * opens / focuses that page in "pick a button" mode; once picked, it is remembered for the page and
 * can be scheduled from the hunt panel ("Hẹn giờ") or from this form.
 */
const NewButtonPicker: React.FC<{ t: ReturnType<typeof getTranslation>; activeUrl?: string; showCurrent: boolean }> = ({
  t,
  activeUrl,
  showCurrent,
}) => {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const valid = isValidHttpUrl(link.trim());
  const go = async (url: string) => {
    await openAndPickViaBackground(url).catch(() => {});
    window.close();
  };
  return (
    <div className="space-y-1.5">
      {showCurrent && activeUrl && (
        <button
          type="button"
          onClick={() => go(activeUrl)}
          className="flex w-full items-center gap-2 rounded-xl border border-dashed border-emerald-500/40 px-3 py-2 text-left text-[12px] font-semibold text-emerald-300 transition hover:bg-emerald-500/10"
        >
          <Crosshair className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{t.scheduleNewOnCurrent(hostOf(activeUrl))}</span>
        </button>
      )}
      {open ? (
        <div className="flex items-center gap-1.5">
          <input
            type="url"
            autoFocus
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder={t.scheduleNewLinkPlaceholder}
            className="min-w-0 flex-1 rounded-xl bg-black/40 px-3 py-2 text-[12px] text-slate-100 outline-none ring-1 ring-white/10 placeholder:text-slate-500 focus:ring-emerald-400"
          />
          <button
            type="button"
            disabled={!valid}
            onClick={() => go(link.trim())}
            className="shrink-0 rounded-xl bg-emerald-500 px-3 py-2 text-[12px] font-bold text-slate-950 transition hover:brightness-110 disabled:opacity-40"
          >
            {t.scheduleNewLinkGo}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 rounded-xl border border-dashed border-white/15 px-3 py-2 text-left text-[12px] font-semibold text-slate-300 transition hover:bg-white/[0.04]"
        >
          <Link2 className="h-3.5 w-3.5 shrink-0" />
          {t.scheduleNewOnOtherPage}
        </button>
      )}
    </div>
  );
};

/** Common drop times in Vietnam. */
const QUICK_TIMES = ["00:00:00", "12:00:00", "20:00:00"];

/**
 * Schedules a hunt for a button the user already picked on its page (decision 1: only picked
 * buttons are clicked). Three choices only: which button, what time, every day or not.
 */
export const ScheduleForm: React.FC<ScheduleFormProps> = ({ onTaskCreated, lang = "en", activeUrl, editing }) => {
  const t = getTranslation(lang);
  const [targets, setTargets] = useState<SavedPageTarget[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [timeInput, setTimeInput] = useState("00:00:00");
  const [isDaily, setIsDaily] = useState(Boolean(editing?.isDaily));
  const [reload, setReload] = useState<boolean | null>(editing ? editing.dualDefenseReload !== false : null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    storage.getSavedPageTargets().then((list) => {
      setTargets(list);
      if (editing) {
        const own =
          list.find((x) => x.id === editing.savedTargetId) ?? list.find((x) => isSamePageUrl(x.url, editing.targetUrl));
        if (own) setSelectedId(own.id);
        setTimeInput(`${pad(editing.targetHour)}:${pad(editing.targetMinute)}:${pad(editing.targetSecond ?? 0)}`);
        return;
      }
      const here = activeUrl ? list.find((x) => isSamePageUrl(x.url, activeUrl)) : undefined;
      const first = here ?? list[0];
      if (first) {
        setSelectedId(first.id);
        if (first.targetSlot === "custom" && first.customTime && parseTimeString(first.customTime).valid) {
          setTimeInput(first.customTime);
        }
      }
    });
  }, [activeUrl, editing]);

  const parsed = useMemo(() => parseTimeString(timeInput), [timeInput]);
  const selected = targets.find((x) => x.id === selectedId);
  const reloadOn = reload ?? selected?.dualDefenseReload !== false;
  const leftText = parsed.valid
    ? t.homeTimeLeft(formatTimeLeft(nextExactDropAt(parsed.h, parsed.m, parsed.s, Date.now()) - Date.now(), t))
    : "";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parsed.valid || !selected) return;
    setSubmitting(true);
    try {
      const task: ScheduledTask = {
        ...(editing ?? {}),
        id: editing?.id ?? Math.random().toString(36).substring(2, 9),
        targetHour: parsed.h,
        targetMinute: parsed.m,
        targetSecond: parsed.s,
        targetUrl: selected.url,
        label: `${parsed.formatted} · ${selected.name}`,
        mode: "full_auto",
        isDaily,
        savedTargetId: selected.id,
        descriptor: selected.descriptor,
        dualDefenseReload: reloadOn,
        diagnostics: selected.diagnostics,
        clickProfileMode: "adaptive",
        preWarmSeconds: 60,
        status: "pending",
        createdAt: editing?.createdAt ?? Date.now(),
        targetAt: undefined,
        lastResult: editing?.lastResult,
      };
      if (editing) await updateTaskViaBackground(task);
      else await scheduleTaskViaBackground(task);
      setDone(true);
      setTimeout(() => setDone(false), 2500);
      onTaskCreated();
    } finally {
      setSubmitting(false);
    }
  };

  const activeIsWeb = Boolean(activeUrl && isValidHttpUrl(activeUrl) && !activeUrl.startsWith("https://chromewebstore"));
  const activeHasButton = Boolean(activeUrl && targets.some((x) => isSamePageUrl(x.url, activeUrl)));
  const [choosing, setChoosing] = useState(false);

  // Button chooser: a page of its own inside the sheet (saved buttons + add a new one), so the
  // schedule page stays short and its submit button never needs scrolling.
  if (choosing || targets.length === 0) {
    return (
      <div className="space-y-3 p-3.5">
        <h2 className="flex items-center gap-1.5 pr-8 text-[13px] font-bold text-white">
          {targets.length > 0 ? (
            <button
              type="button"
              onClick={() => setChoosing(false)}
              aria-label={t.scheduleBack}
              className="-ml-1 rounded-md p-0.5 text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          ) : (
            <CalendarClock className="h-4 w-4 text-emerald-400" />
          )}
          {targets.length > 0 ? t.scheduleChooseButton : t.scheduleTitle}
        </h2>
        {targets.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-slate-400">{t.scheduleNoSavedButtons}</p>
        ) : (
          <div className="-m-0.5 max-h-[230px] space-y-1 overflow-y-auto p-0.5" role="radiogroup" aria-label={t.scheduleChooseButton}>
            {targets.map((target) => {
              const active = target.id === selectedId;
              return (
                <button
                  key={target.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    setSelectedId(target.id);
                    setChoosing(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left transition ${
                    active ? "bg-emerald-500/15 ring-1 ring-emerald-500/40" : "hover:bg-white/[0.06]"
                  }`}
                >
                  <span className={`h-3 w-3 shrink-0 rounded-full ring-2 ${active ? "bg-emerald-400 ring-emerald-400/40" : "ring-white/20"}`} />
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-semibold text-slate-100">{target.name}</span>
                    <span className="block truncate text-[10px] text-slate-500">{hostOf(target.url)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {!editing && (
          <div className={targets.length > 0 ? "border-t border-white/10 pt-3" : ""}>
            {targets.length > 0 && (
              <p className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-slate-400">
                <Plus className="h-3 w-3" />
                {t.scheduleNewButton}
              </p>
            )}
            <NewButtonPicker t={t} activeUrl={activeUrl} showCurrent={activeIsWeb && !activeHasButton} />
          </div>
        )}
      </div>
    );
  }

  const toggleRow = (on: boolean, onClick: () => void, Icon: typeof Repeat, label: string) => (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className="flex w-full items-center justify-between px-3 py-2.5 text-left transition hover:bg-white/[0.04]"
    >
      <span className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 ${on ? "text-emerald-300" : "text-slate-400"}`} />
        <span className="text-[12px] font-semibold text-slate-200">{label}</span>
      </span>
      <span className={`relative h-4 w-7 shrink-0 rounded-full transition ${on ? "bg-emerald-500" : "bg-white/15"}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${on ? "left-3.5" : "left-0.5"}`} />
      </span>
    </button>
  );

  return (
    <form onSubmit={submit} className="flex flex-col">
      <div className="space-y-3.5 p-3.5 pb-2">
        <h2 className="flex items-center gap-1.5 pr-8 text-[13px] font-bold text-white">
          <CalendarClock className="h-4 w-4 text-emerald-400" />
          {editing ? t.scheduleEditTitle : t.scheduleTitle}
        </h2>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-[11px] font-semibold text-slate-300">{t.scheduleButtonLabel}</p>
            {selected && (
              <button
                type="button"
                onClick={async () => {
                  await openAndPickViaBackground(selected.url).catch(() => {});
                  window.close();
                }}
                className="flex items-center gap-1 text-[11px] font-semibold text-emerald-300 hover:underline"
              >
                <Crosshair className="h-3 w-3" />
                {t.scheduleRepickShort}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setChoosing(true)}
            className="flex w-full items-center gap-2 rounded-xl bg-black/30 px-3 py-2 text-left ring-1 ring-white/10 transition hover:bg-white/[0.06]"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-semibold text-slate-100">{selected?.name ?? t.scheduleChooseButton}</span>
              {selected && <span className="block truncate text-[10px] text-slate-500">{hostOf(selected.url)}</span>}
            </span>
            <span className="flex shrink-0 items-center text-[11px] font-semibold text-slate-400">
              {t.scheduleChange}
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </button>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="dh-schedule-time" className="text-[11px] font-semibold text-slate-300">
              {t.exactTimePrompt}
            </label>
            {leftText && <span className="text-[11px] text-slate-400">{leftText}</span>}
          </div>
          <div className="flex items-center gap-1.5">
            <input
              id="dh-schedule-time"
              type="text"
              inputMode="numeric"
              value={timeInput}
              onChange={(e) => setTimeInput(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => parsed.valid && setTimeInput(parsed.formatted)}
              placeholder="20h30"
              className={`w-[92px] shrink-0 rounded-xl bg-black/40 px-2 py-2 text-center font-mono text-[14px] font-bold outline-none ring-1 focus:ring-2 ${
                parsed.valid ? "text-emerald-300 ring-white/10 focus:ring-emerald-400" : "text-rose-300 ring-rose-500/50"
              }`}
            />
            {QUICK_TIMES.map((time) => (
              <button
                key={time}
                type="button"
                onClick={() => setTimeInput(time)}
                className={`flex-1 rounded-xl py-2 text-[12px] font-semibold transition ${
                  parsed.valid && parsed.formatted === time
                    ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40"
                    : "bg-white/5 text-slate-300 ring-1 ring-white/10 hover:bg-white/10"
                }`}
              >
                {time.slice(0, 5)}
              </button>
            ))}
          </div>
          {!parsed.valid && <p className="mt-1 text-[11px] font-semibold text-rose-400">{t.invalidTimeFormat}</p>}
        </div>

        <div className="divide-y divide-white/10 overflow-hidden rounded-xl bg-black/30 ring-1 ring-white/10">
          {toggleRow(isDaily, () => setIsDaily(!isDaily), Repeat, t.dailyScheduleCheckbox)}
          {toggleRow(reloadOn, () => setReload(!reloadOn), RefreshCw, t.preReloadToggle)}
        </div>
      </div>

      <div className="sticky bottom-0 bg-[#0d1220] px-3.5 pb-3 pt-2">
        <button
          type="submit"
          disabled={submitting || !parsed.valid || !selected}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-2.5 text-[13px] font-bold text-slate-950 shadow-lg shadow-emerald-950/50 transition hover:brightness-110 disabled:opacity-50"
        >
          {done ? <CheckCircle2 className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}
          {done ? t.quickScheduleSuccess : editing ? t.scheduleSaveChanges : t.scheduleSubmitBtn(parsed.formatted)}
        </button>
      </div>
    </form>
  );
};
