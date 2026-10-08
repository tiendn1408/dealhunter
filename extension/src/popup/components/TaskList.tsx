import React from "react";
import { Trash2 } from "lucide-react";
import { ScheduledTask } from "../../lib/types";
import { taskScheduler } from "../../background/scheduler";
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
      <div className="text-center py-6 border border-dashed border-slate-200 rounded-2xl bg-white/50 text-slate-400 text-xs">
        {t.noTasks}
      </div>
    );
  }

  const handleDelete = async (id: string) => {
    await taskScheduler.cancelTask(id);
    onTasksChanged();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs font-bold text-slate-700 px-1">
        <span>{t.scheduledHunts(tasks.length)}</span>
      </div>

      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="bg-white border border-slate-200/90 rounded-xl p-2.5 shadow-2xs flex items-center justify-between gap-2"
          >
            <div className="space-y-0.5 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-xs text-slate-900 truncate">{task.label}</span>
                <span
                  className={`text-[9px] font-bold px-1.5 py-0.2 rounded-md ${
                    task.mode === "full_auto"
                      ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                      : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  }`}
                >
                  {task.mode === "full_auto" ? "Full-Auto" : "Semi-Auto"}
                </span>
              </div>

              <div className="text-[10px] text-slate-400 flex items-center gap-2">
                <span>{task.targetHour}:00</span>
                {task.keyword && <span>{t.filterPrefix} "{task.keyword}"</span>}
                <span
                  className={`font-semibold ${
                    task.status === "completed"
                      ? "text-emerald-600"
                      : task.status === "failed"
                      ? "text-rose-600"
                      : "text-slate-500"
                  }`}
                >
                  {t.status[task.status]}
                </span>
              </div>
              {task.lastResult && (
                <div className="text-[10px] text-slate-500">
                  {task.lastResult.detail} ({t.clicksLabel(task.lastResult.clicks)})
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => handleDelete(task.id)}
              className="text-slate-400 hover:text-rose-600 p-1 rounded-lg transition-colors shrink-0"
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

