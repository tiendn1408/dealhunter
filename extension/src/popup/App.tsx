import React, { useState, useEffect } from "react";
import { TimeOffsetCard } from "./components/TimeOffsetCard";
import { ScheduleForm } from "./components/ScheduleForm";
import { TaskList } from "./components/TaskList";
import { storage } from "../lib/storage";
import { ScheduledTask } from "../lib/types";
import { Zap, ExternalLink, Shield } from "lucide-react";

export const App: React.FC = () => {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);

  const loadTasks = async () => {
    const list = await storage.getTasks();
    setTasks(list);
  };

  useEffect(() => {
    loadTasks();
  }, []);

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-black text-xs shadow-sm">
            DH
          </div>
          <div>
            <h1 className="text-sm font-black text-pine-900 leading-none">DealHunter Assistant</h1>
            <span className="text-[10px] text-slate-400 font-medium">Shopee Fast Voucher Clicker</span>
          </div>
        </div>

        <a
          href="http://localhost:3000"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-200/80"
        >
          <span>Web App</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Clock Calibration Card */}
      <TimeOffsetCard />

      {/* Schedule Form */}
      <ScheduleForm onTaskCreated={loadTasks} />

      {/* Task List */}
      <TaskList tasks={tasks} onTasksChanged={loadTasks} />

      {/* Footer Info */}
      <div className="text-[10px] text-slate-400 text-center flex items-center justify-center gap-1.5 pt-1">
        <Shield className="w-3 h-3 text-emerald-600" />
        <span>Chay hoan toan tren client. An toan 100% truoc bot scanner.</span>
      </div>
    </div>
  );
};
