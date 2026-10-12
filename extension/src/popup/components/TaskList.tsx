import React from "react";
import { Trash2, Repeat, Globe, Crosshair, ExternalLink, CheckCircle2 } from "lucide-react";
import { ScheduledTask } from "../../lib/types";
import { cancelTaskViaBackground } from "../../lib/scheduler_client";
import { Language, getTranslation } from "../../lib/i18n";

interface TaskListProps {
  tasks: ScheduledTask[];
  onTasksChanged: () => void;
  lang?: Language;
}

function parseUrlDisplay(rawUrl: string): { host: string; path: string } {
  if (!rawUrl) return { host: "web", path: "" };
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname === "/" ? "" : u.pathname;
    return { host, path };
  } catch {
    return { host: rawUrl.slice(0, 30), path: "" };
  }
}

function extractTargetName(task: ScheduledTask, fallback: string): string {
  if (task.descriptor?.initialText?.trim()) {
    return task.descriptor.initialText.trim();
  }
  if (task.label) {
    const stripped = task.label.replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*·\s*/, "").trim();
    if (stripped) return stripped;
  }
  return fallback;
}

export const TaskList: React.FC<TaskListProps> = ({ tasks, onTasksChanged, lang = "en" }) => {
  const t = getTranslation(lang);

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="shrink-0 flex items-center justify-between text-xs font-semibold text-slate-300 px-1 pb-2">
          <span>{t.scheduledHunts(0)}</span>
        </div>
        <div className="flex-1 flex items-center justify-center border border-dashed border-white/10 rounded-2xl bg-white/[0.02] text-slate-500 text-xs py-8">
          {t.noTasks}
        </div>
      </div>
    );
  }

  const handleDelete = async (id: string) => {
    try {
      await cancelTaskViaBackground(id);
    } catch {
      // ignore
    }
    onTasksChanged();
  };

  const handleOpenUrl = (e: React.MouseEvent, url: string) => {
    e.stopPropagation();
    if (!url) return;
    if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.create({ url });
    } else {
      window.open(url, "_blank");
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Fixed Title Header: NEVER scrolls away */}
      <div className="shrink-0 flex items-center justify-between text-xs font-semibold text-slate-300 px-1 pb-2">
        <span>{t.scheduledHunts(tasks.length)}</span>
      </div>

      {/* Scrollable Tasks List */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-0.5">
        {tasks.map((task) => {
          const urlInfo = parseUrlDisplay(task.targetUrl);
          const hasLockedTarget = Boolean(task.descriptor || task.savedTargetId);
          const targetName = hasLockedTarget
            ? extractTargetName(task, t.targetButtonDefault)
            : t.noTargetOnCurrentPage;
          const timeStr = `${String(task.targetHour).padStart(2, "0")}:${String(task.targetMinute).padStart(2, "0")}:${String(task.targetSecond ?? 0).padStart(2, "0")}`;

          const statusBadge =
            task.status === "completed"
              ? { text: t.status.completed, badge: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30", dot: "bg-emerald-400" }
              : task.status === "running"
              ? { text: t.status.running, badge: "bg-teal-500/10 text-teal-300 ring-teal-500/30 ring-1", dot: "bg-teal-400 animate-ping" }
              : task.status === "failed"
              ? { text: t.status.failed, badge: "bg-rose-500/10 text-rose-300 ring-rose-500/30", dot: "bg-rose-400" }
              : task.status === "cancelled" || task.status === "missed"
              ? { text: t.status[task.status], badge: "bg-slate-500/10 text-slate-400 ring-slate-500/20", dot: "bg-slate-400" }
              : { text: t.status.pending, badge: "bg-amber-500/10 text-amber-300 ring-amber-500/30", dot: "bg-amber-400" };

          return (
            <div
              key={task.id}
              className="bg-white/[0.03] border border-white/10 hover:border-white/20 rounded-xl p-2.5 shadow-sm space-y-2 transition"
            >
              {/* Row 1: Time, Status, Badges & Delete */}
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-mono text-xs font-bold text-emerald-400 shrink-0">
                    {timeStr}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ring-1 shrink-0 ${statusBadge.badge}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${statusBadge.dot}`} />
                    <span className="truncate">{statusBadge.text}</span>
                  </span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {task.isDaily && (
                    <span className="flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0">
                      <Repeat className="h-2.5 w-2.5" />
                      {t.dailyScheduleBadge}
                    </span>
                  )}
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md shrink-0 ${
                      task.mode === "full_auto"
                        ? "bg-indigo-500/15 text-indigo-300 border border-indigo-500/30"
                        : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                    }`}
                  >
                    {task.mode === "full_auto" ? t.fullyAutomatic : t.semiAuto}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDelete(task.id)}
                    className="text-slate-500 hover:text-rose-400 p-1 rounded-lg transition-colors hover:bg-white/5 shrink-0"
                    title={t.deleteTaskTooltip}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Row 2: Target Page / Domain (Clickable to open URL) */}
              <div className="flex items-center justify-between gap-1.5 pt-1.5 border-t border-white/5 text-[10px]">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <Globe className="h-3 w-3 text-emerald-400/80 shrink-0" />
                  <span className="text-slate-400 shrink-0">{t.taskTargetPage}</span>
                  <button
                    type="button"
                    onClick={(e) => handleOpenUrl(e, task.targetUrl)}
                    title={t.openTargetUrlTooltip(task.targetUrl)}
                    className="group flex items-center gap-1 min-w-0 font-mono text-[11px] font-bold text-slate-200 hover:text-emerald-300 transition text-left"
                  >
                    <span className="truncate">{urlInfo.host}{urlInfo.path}</span>
                    <ExternalLink className="h-2.5 w-2.5 text-slate-500 group-hover:text-emerald-300 shrink-0" />
                  </button>
                </div>
              </div>

              {/* Row 3: Target Button / Keyword / Lock Status */}
              <div className="flex items-center justify-between gap-1.5 text-[10px]">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <Crosshair className="h-3 w-3 text-teal-400/80 shrink-0" />
                  <span className="text-slate-400 shrink-0">{t.taskTargetButton}</span>
                  <span className="font-semibold text-slate-200 truncate" title={targetName}>
                    {targetName}
                  </span>
                  {task.keyword && (
                    <span className="text-slate-400 truncate">
                      ({t.filterPrefix} "{task.keyword}")
                    </span>
                  )}
                </div>

                {hasLockedTarget ? (
                  <span className="shrink-0 flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300 ring-1 ring-emerald-500/30">
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    {t.locked}
                  </span>
                ) : (
                  <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-300 ring-1 ring-amber-500/30">
                    {t.opensAtDrop}
                  </span>
                )}
              </div>

              {/* Row 4: Results (if any) */}
              {task.lastResult && (
                <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[9px] font-mono text-slate-400">
                  <span className="truncate">{task.lastResult.detail}</span>
                  <span className="shrink-0 text-slate-500">({t.clicksLabel(task.lastResult.clicks)})</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
