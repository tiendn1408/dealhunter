import React, { useState, useEffect } from "react";
import { TimeOffsetCard } from "./components/TimeOffsetCard";
import { ScheduleForm } from "./components/ScheduleForm";
import { TaskList } from "./components/TaskList";
import { storage } from "../lib/storage";
import { DEFAULT_SETTINGS, MESSAGE_ACTIONS } from "../lib/constants";
import { ScheduledTask } from "../lib/types";
import { ExternalLink, ShieldCheck } from "lucide-react";

export const App: React.FC = () => {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [webUrl, setWebUrl] = useState(DEFAULT_SETTINGS.dealHunterWebUrl);
  // null while loading; the web app hands its sign-in over to the extension
  const [account, setAccount] = useState<{ signedIn: boolean; email?: string } | null>(null);

  const loadTasks = async () => {
    setTasks(await storage.getTasks());
  };

  useEffect(() => {
    storage.getSettings().then((s) => setWebUrl(s.dealHunterWebUrl));
    chrome.runtime
      .sendMessage({ action: MESSAGE_ACTIONS.GET_WEB_SESSION })
      .then(setAccount)
      .catch(() => setAccount({ signedIn: false }));
  }, []);

  useEffect(() => {
    loadTasks();
    // Hunts finish in the background: refresh the list when their status changes
    const onChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.dh_scheduled_tasks) loadTasks();
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  return (
    <div className="min-h-[520px] bg-slate-50">
      {/* Header */}
      <header className="relative overflow-hidden bg-slate-950 px-5 pb-5 pt-4 text-white">
        <div className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-emerald-500/30 blur-3xl" />
        <div className="pointer-events-none absolute -left-12 top-6 h-32 w-32 rounded-full bg-teal-500/20 blur-3xl" />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 text-sm font-black shadow-lg shadow-emerald-900/50">
              DH
            </div>
            <div className="leading-tight">
              <h1 className="text-[15px] font-bold tracking-tight">DealHunter Assistant</h1>
              <p className="text-[11px] font-medium text-slate-400">Shopee voucher sniper</p>
            </div>
          </div>
          <a
            href={webUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15"
          >
            Web app
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </header>

      <main className="-mt-3 space-y-3 px-4 pb-4">
        {account && (
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600 shadow-sm">
            {account.signedIn ? (
              <span>
                Da ket noi DealHunter{account.email ? `: ${account.email}` : ""}. Gia theo doi hien tren trang san pham Shopee.
              </span>
            ) : (
              <span>
                Chua dang nhap DealHunter web: chi dung cac tinh nang san deal.{" "}
                <a href={webUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald-700 hover:underline">
                  Dang nhap
                </a>{" "}
                de xem gia theo doi ngay tren Shopee.
              </span>
            )}
          </div>
        )}
        <TimeOffsetCard />
        <ScheduleForm onTaskCreated={loadTasks} />
        <TaskList tasks={tasks} onTasksChanged={loadTasks} />

        <p className="flex items-center justify-center gap-1.5 pt-1 text-[10px] text-slate-400">
          <ShieldCheck className="h-3 w-3 text-emerald-600" />
          Runs in your browser with your own Shopee account.
        </p>
      </main>
    </div>
  );
};
