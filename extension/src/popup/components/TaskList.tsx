import React from "react";
import { Trash2 } from "lucide-react";
import { ScheduledTask } from "../../lib/types";
import { taskScheduler } from "../../background/scheduler";
import { MESSAGE_ACTIONS } from "../../lib/constants";
import { Language, getTranslation } from "../../lib/i18n";

interface TaskListProps {
  tasks: ScheduledTask[];
  onTasksChanged: () => void;
  lang?: Language;
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
      await chrome.runtime.sendMessage({ action: MESSAGE_ACTIONS.CANCEL_TASK, taskId: id });
    } catch {
      await taskScheduler.cancelTask(id);
    }
    onTasksChanged();
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Fixed Title Header: NEVER scrolls away */}
      <div className="shrink-0 flex items-center justify-between text-xs font-semibold text-slate-300 px-1 pb-2">
        <span>{t.scheduledHunts(tasks.length)}</span>
      </div>

      {/* Scrollable Tasks List */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-0.5">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="bg-white/[0.03] border border-white/10 rounded-xl p-3 shadow-sm flex items-center justify-between gap-2.5"
          >
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs text-slate-100 truncate">{task.label}</span>
                <span
                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${
                    task.mode === "full_auto"
                      ? "bg-indigo-500/15 text-indigo-300 border border-indigo-500/30"
                      : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                  }`}
                >
                  {task.mode === "full_auto" ? "Full-Auto" : "Semi-Auto"}
                </span>
              </div>

              <div className="text-[10px] text-slate-400 flex items-center gap-2">
                <span className="font-mono text-slate-300">
                  {`${String(task.targetHour).padStart(2, "0")}:${String(task.targetMinute).padStart(2, "0")}:${String(task.targetSecond ?? 0).padStart(2, "0")}`}
                </span>
                {(task.descriptor || task.savedTargetId) && (
                  <span className="rounded bg-emerald-500/10 px-1 py-0.5 text-[9px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                    {t.locked}
                  </span>
                )}
                {task.keyword && <span>{t.filterPrefix} "{task.keyword}"</span>}
                <span
                  className={`font-semibold ${
                    task.status === "completed"
                      ? "text-emerald-400"
                      : task.status === "failed"
                      ? "text-rose-400"
                      : "text-amber-400"
                  }`}
                >
                  {t.status[task.status]}
                </span>
              </div>
              {task.lastResult && (
                <div className="text-[10px] text-slate-400 font-mono">
                  {task.lastResult.detail} ({t.clicksLabel(task.lastResult.clicks)})
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => handleDelete(task.id)}
              className="text-slate-500 hover:text-rose-400 p-1.5 rounded-lg transition-colors shrink-0 hover:bg-white/5"
              title={t.deleteTaskTooltip}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

