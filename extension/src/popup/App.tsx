import React, { useState, useEffect } from "react";
import { Home, ListTodo, Settings, Plus, X } from "lucide-react";
import { HomePanel } from "./components/HomePanel";
import { ScheduleForm } from "./components/ScheduleForm";
import { TaskList } from "./components/TaskList";
import { SettingsPanel } from "./components/SettingsPanel";
import { storage } from "../lib/storage";
import { DEFAULT_SETTINGS, MESSAGE_ACTIONS } from "../lib/constants";
import { ScheduledTask } from "../lib/types";
import { Language, getTranslation } from "../lib/i18n";

type View = "home" | "hunts" | "settings";

/**
 * Popup: opens on what to do next for the page in front of the user (HomePanel). Two tabs only
 * (this page / my hunts) and the settings behind the gear; nothing technical on the way.
 */
export const App: React.FC = () => {
  const [view, setView] = useState<View>("home");
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [webUrl, setWebUrl] = useState(DEFAULT_SETTINGS.dealHunterWebUrl);
  const [lang, setLang] = useState<Language>("vi");
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [activeTabUrl, setActiveTabUrl] = useState("");
  const [activeTabDomain, setActiveTabDomain] = useState("");
  const [account, setAccount] = useState<{ signedIn: boolean; email?: string } | null>(null);
  const [showScheduleForm, setShowScheduleForm] = useState(false);

  const t = getTranslation(lang);
  const loadTasks = async () => setTasks(await storage.getTasks());

  // The tab the user is looking at (and when they switch tabs with the popup open)
  useEffect(() => {
    const update = () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const active = tabs[0];
        setActiveTabId(active?.id ?? null);
        const url = active?.url || "";
        setActiveTabUrl(url);
        try {
          setActiveTabDomain(/^https?:/i.test(url) ? new URL(url).hostname.replace(/^www\./, "") : "");
        } catch {
          setActiveTabDomain("");
        }
      });
    };
    update();
    chrome.tabs.onActivated.addListener(update);
    chrome.tabs.onUpdated.addListener(update);
    return () => {
      chrome.tabs.onActivated.removeListener(update);
      chrome.tabs.onUpdated.removeListener(update);
    };
  }, []);

  useEffect(() => {
    storage.getEndpoints().then((e) => setWebUrl(e.webUrl));
    storage.getLanguage().then(setLang);
    chrome.runtime
      .sendMessage({ action: MESSAGE_ACTIONS.GET_WEB_SESSION })
      .then(setAccount)
      .catch(() => setAccount({ signedIn: false }));
  }, []);

  useEffect(() => {
    loadTasks();
    const onChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.dh_scheduled_tasks) loadTasks();
      const next = changes.dh_settings?.newValue?.language;
      if (next === "en" || next === "vi") setLang(next);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  const changeLang = async (next: Language) => {
    setLang(next);
    await storage.setLanguage(next);
  };

  const upcomingCount = tasks.filter((x) => x.status === "pending" || x.status === "running").length;

  const tab = (id: View, icon: React.ReactNode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={view === id}
      onClick={() => setView(id)}
      className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-[12px] font-semibold transition ${
        view === id ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40" : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <div className="flex h-[580px] w-[390px] max-h-[580px] min-h-[580px] flex-col overflow-hidden bg-[#090d16] text-slate-100 select-none">
      <header className="flex shrink-0 items-center justify-between border-b border-white/[0.08] bg-black/40 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <img src="/icons/icon48.png" alt="" className="h-8 w-8 rounded-xl object-cover shadow-md shadow-emerald-500/20" />
          <div className="leading-tight">
            <h1 className="text-[15px] font-bold tracking-tight text-white">{t.appName}</h1>
            <p className="text-[11px] text-emerald-400/90">{t.appSubtitle}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setView(view === "settings" ? "home" : "settings")}
          aria-label={t.settingsTitle}
          aria-pressed={view === "settings"}
          title={t.settingsTitle}
          className={`flex h-8 w-8 items-center justify-center rounded-xl ring-1 transition ${
            view === "settings"
              ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40"
              : "bg-white/5 text-slate-300 ring-white/10 hover:bg-white/10 hover:text-white"
          }`}
        >
          <Settings className="h-4 w-4" />
        </button>
      </header>

      {view !== "settings" && (
        <nav role="tablist" className="grid shrink-0 grid-cols-2 gap-1 border-b border-white/[0.06] bg-black/20 p-1.5">
          {tab("home", <Home className="h-3.5 w-3.5" />, t.tabHome)}
          {tab("hunts", <ListTodo className="h-3.5 w-3.5" />, t.tabHunts(upcomingCount))}
        </nav>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
        {view === "home" && (
          <HomePanel
            lang={lang}
            activeTabId={activeTabId}
            activeUrl={activeTabUrl}
            activeDomain={activeTabDomain}
            tasks={tasks}
            onSeeAllHunts={() => setView("hunts")}
          />
        )}

        {view === "hunts" && (
          <div className="space-y-3">
            {showScheduleForm ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowScheduleForm(false)}
                  aria-label={t.settingsCancel}
                  className="absolute right-2.5 top-2.5 z-10 rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <ScheduleForm
                  lang={lang}
                  activeUrl={activeTabUrl}
                  onTaskCreated={() => {
                    loadTasks();
                    setShowScheduleForm(false);
                  }}
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowScheduleForm(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-emerald-500/40 bg-emerald-500/5 py-2.5 text-[12px] font-semibold text-emerald-300 transition hover:bg-emerald-500/10"
              >
                <Plus className="h-3.5 w-3.5" />
                {t.newScheduleCta}
              </button>
            )}
            <TaskList tasks={tasks} onTasksChanged={loadTasks} lang={lang} />
          </div>
        )}

        {view === "settings" && (
          <SettingsPanel lang={lang} onLangChange={changeLang} account={account} webUrl={webUrl} onBack={() => setView("home")} />
        )}
      </main>
    </div>
  );
};
