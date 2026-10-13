import React, { useEffect, useState } from "react";
import { Trash2, Repeat, ExternalLink } from "lucide-react";
import { ScheduledTask } from "../../lib/types";
import { cancelTaskViaBackground } from "../../lib/scheduler_client";
import { formatTimeLeft } from "../../lib/drop_time";
import { Language, getTranslation } from "../../lib/i18n";
import { taskButtonName } from "./HomePanel";

interface TaskListProps {
  tasks: ScheduledTask[];
  onTasksChanged: () => void;
  lang?: Language;
  /** Opens a hunt for editing (time, button, every day, refresh). */
  onEdit?: (task: ScheduledTask) => void;
}

const pad = (n: number) => String(n).padStart(2, "0");

function hostOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return rawUrl.slice(0, 30);
  }
}

const STATUS_STYLE: Record<ScheduledTask["status"], string> = {
  pending: "bg-amber-500/10 text-amber-300 ring-amber-500/30",
  running: "bg-teal-500/10 text-teal-300 ring-teal-500/30",
  completed: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
  failed: "bg-rose-500/10 text-rose-300 ring-rose-500/30",
  cancelled: "bg-slate-500/10 text-slate-400 ring-slate-500/20",
  missed: "bg-slate-500/10 text-slate-400 ring-slate-500/20",
};

/** Upcoming hunts first (soonest on top), then finished ones (latest first). */
function ordered(tasks: ScheduledTask[]): ScheduledTask[] {
  const upcoming = tasks.filter((x) => x.status === "pending" || x.status === "running");
  const past = tasks.filter((x) => !upcoming.includes(x));
  upcoming.sort((a, b) => (a.targetAt ?? Infinity) - (b.targetAt ?? Infinity));
  past.sort((a, b) => (b.lastResult?.finishedAt ?? b.createdAt) - (a.lastResult?.finishedAt ?? a.createdAt));
  return [...upcoming, ...past];
}

export const TaskList: React.FC<TaskListProps> = ({ tasks, onTasksChanged, lang = "en", onEdit }) => {
  const t = getTranslation(lang);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (tasks.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-5 text-center text-[12px] leading-relaxed text-slate-400">
        {t.noTasks}
      </div>
    );
  }

  const remove = async (id: string) => {
    try {
      await cancelTaskViaBackground(id);
    } catch {
      // ignore
    }
    onTasksChanged();
  };

  return (
    <ul className="space-y-2">
      {ordered(tasks).map((task) => {
        const time = `${pad(task.targetHour)}:${pad(task.targetMinute)}:${pad(task.targetSecond ?? 0)}`;
        const upcoming = task.status === "pending" || task.status === "running";
        return (
          <li
            key={task.id}
            role="button"
            tabIndex={0}
            title={t.taskEditHint}
            onClick={() => onEdit?.(task)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onEdit?.(task)}
            className="cursor-pointer rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.08] transition hover:bg-white/[0.06] hover:ring-emerald-500/30"
          >
            <div className="flex items-start gap-3">
              <div className="w-[62px] shrink-0">
                <div className={`font-mono text-[15px] font-bold ${upcoming ? "text-emerald-300" : "text-slate-400"}`}>{time.slice(0, 5)}</div>
                {task.targetSecond ? <div className="font-mono text-[10px] text-slate-500">:{pad(task.targetSecond)}</div> : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-slate-100">{taskButtonName(task, t.targetButtonDefault)}</div>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-slate-400">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      chrome.tabs.create({ url: task.targetUrl });
                    }}
                    title={t.openTargetUrlTooltip(task.targetUrl)}
                    className="flex min-w-0 items-center gap-1 hover:text-emerald-300"
                  >
                    <span className="truncate">{hostOf(task.targetUrl)}</span>
                    <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                  </button>
                  {upcoming && task.targetAt && (
                    <span className="shrink-0 whitespace-nowrap text-slate-500">· {t.homeTimeLeft(formatTimeLeft(task.targetAt - now, t))}</span>
                  )}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${STATUS_STYLE[task.status]}`}>
                    {t.status[task.status]}
                  </span>
                  {task.isDaily && (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                      <Repeat className="h-2.5 w-2.5" />
                      {t.dailyScheduleBadge}
                    </span>
                  )}
                </div>
                {task.lastResult && (
                  <p className="mt-1.5 text-[11px] leading-snug text-slate-400">
                    <span className="text-slate-500">{t.taskLastResult} </span>
                    {t.outcome[task.lastResult.result as keyof typeof t.outcome] ?? task.lastResult.detail}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(task.id);
                }}
                title={t.deleteTaskTooltip}
                aria-label={t.deleteTaskTooltip}
                className="shrink-0 rounded-lg p-1.5 text-slate-500 transition hover:bg-white/5 hover:text-rose-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
};
