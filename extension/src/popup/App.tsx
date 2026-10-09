import React, { useState, useEffect } from "react";
import { TimeOffsetCard } from "./components/TimeOffsetCard";
import { ScheduleForm } from "./components/ScheduleForm";
import { TaskList } from "./components/TaskList";
import { storage } from "../lib/storage";
import { resolveEndpoints } from "../lib/endpoints";
import { DEFAULT_SETTINGS, MESSAGE_ACTIONS, SHOPEE_FLASH_HOURS, SHOPEE_URLS } from "../lib/constants";
import { ScheduledTask } from "../lib/types";
import { Language, getTranslation } from "../lib/i18n";
import { nextFlashDrop, formatVN } from "../lib/drop_time";
import {
  Crosshair,
  CalendarClock,
  ListTodo,
  Zap,
  ExternalLink,
  ShieldCheck,
  Languages,
  Timer,
  CheckCircle2,
} from "lucide-react";

type TabMode = "live" | "schedule" | "tasks";

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabMode>("live");
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [webUrl, setWebUrl] = useState(DEFAULT_SETTINGS.dealHunterWebUrl);
  const [lang, setLang] = useState<Language>("en");
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [activeTabUrl, setActiveTabUrl] = useState<string>("");
  const [activeTabDomain, setActiveTabDomain] = useState<string>("");
  const [isWebPage, setIsWebPage] = useState<boolean>(false);
  const [countdownStr, setCountdownStr] = useState("--:--.-");
  const [nextDropHour, setNextDropHour] = useState<number>(0);
  const [account, setAccount] = useState<{ signedIn: boolean; email?: string } | null>(null);
  const [launchedToast, setLaunchedToast] = useState(false);

  const t = getTranslation(lang);

  const loadTasks = async () => {
    setTasks(await storage.getTasks());
  };

  // 1. Detect current browser tab & track tab switches
  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.tabs) {
      const updateActiveTab = () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const active = tabs[0];
          if (active?.id) {
            setActiveTabId(active.id);
            const url = active.url || "";
            setActiveTabUrl(url);
            if (url.startsWith("http://") || url.startsWith("https://")) {
              setIsWebPage(true);
              try {
                setActiveTabDomain(new URL(url).hostname.replace(/^www\./, ""));
              } catch {
                setActiveTabDomain("web");
              }
            } else {
              setIsWebPage(false);
              setActiveTabDomain("");
            }
          }
        });
      };

      updateActiveTab();
      chrome.tabs.onActivated.addListener(updateActiveTab);
      chrome.tabs.onUpdated.addListener(updateActiveTab);
      return () => {
        chrome.tabs.onActivated.removeListener(updateActiveTab);
        chrome.tabs.onUpdated.removeListener(updateActiveTab);
      };
    }
  }, []);

  // 2. Countdown clock to next drop
  useEffect(() => {
    const updateCountdown = () => {
      const now = Date.now();
      const nextDrop = nextFlashDrop(SHOPEE_FLASH_HOURS, now);
      setNextDropHour(nextDrop.hour);
      const diff = Math.max(0, nextDrop.at - now);
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      const tenth = Math.floor((diff % 1000) / 100);
      const mmss = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${tenth}`;
      setCountdownStr(h > 0 ? `${h}:${mmss}` : mmss);
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 100);
    return () => clearInterval(timer);
  }, []);

  // 3. Settings & Web Session
  useEffect(() => {
    storage.getSettings().then((s) => {
      setWebUrl(resolveEndpoints(s).webUrl);
      if (s.language) setLang(s.language);
    });
    chrome.runtime
      .sendMessage({ action: MESSAGE_ACTIONS.GET_WEB_SESSION })
      .then(setAccount)
      .catch(() => setAccount({ signedIn: false }));
  }, []);

  // 4. Tasks listener
  useEffect(() => {
    loadTasks();
    const onChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.dh_scheduled_tasks) loadTasks();
      if (changes.dh_settings?.newValue?.language) {
        setLang(changes.dh_settings.newValue.language);
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  const handleToggleLang = async () => {
    const nextLang: Language = lang === "en" ? "vi" : "en";
    setLang(nextLang);
    await storage.setLanguage(nextLang);
  };

  // Launch Sniper CTA: If on an active web page, activate in-page HUD directly! Otherwise open Shopee.
  const handleStartSniper = async () => {
    if (isWebPage && activeTabId) {
      try {
        await chrome.tabs.sendMessage(activeTabId, { action: MESSAGE_ACTIONS.ACTIVATE_HUD });
        setLaunchedToast(true);
        setTimeout(() => window.close(), 600);
      } catch {
        // Tab was opened before extension was loaded: inject content script via scripting API
        if (typeof chrome !== "undefined" && chrome.scripting) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: activeTabId },
              files: ["content.js"],
            });
            await chrome.tabs.sendMessage(activeTabId, { action: MESSAGE_ACTIONS.ACTIVATE_HUD });
            setLaunchedToast(true);
            setTimeout(() => window.close(), 600);
            return;
          } catch (injectErr) {
            console.warn("Scripting injection failed:", injectErr);
          }
        }
        if (activeTabUrl) {
          await chrome.tabs.reload(activeTabId);
        } else {
          await chrome.tabs.create({ url: SHOPEE_URLS.VOUCHER_HUB });
        }
        window.close();
      }
    } else {
      await chrome.tabs.create({ url: SHOPEE_URLS.VOUCHER_HUB });
      window.close();
    }
  };

  return (
    <div className="flex h-[580px] w-[390px] max-h-[580px] min-h-[580px] flex-col bg-[#090d16] text-slate-100 select-none overflow-hidden">
      {/* 1. Header */}
      <header className="shrink-0 relative flex items-center justify-between border-b border-white/[0.08] bg-black/40 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <img
            src="/icons/icon48.png"
            alt="DealHunter"
            className="h-8 w-8 rounded-xl object-cover shadow-md shadow-emerald-500/20"
          />
          <div className="leading-tight">
            <h1 className="text-[14px] font-bold tracking-tight text-white">{t.appName}</h1>
            <p className="text-[10px] font-medium text-emerald-400/90">{t.appSubtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleToggleLang}
            className="flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-[10px] font-bold text-emerald-300 ring-1 ring-white/10 transition hover:bg-white/10"
            title={lang === "en" ? "Đổi sang Tiếng Việt" : "Switch to English"}
          >
            <Languages className="h-3 w-3" />
            <span>{lang.toUpperCase()}</span>
          </button>
          <a
            href={webUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-slate-300 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white"
          >
            <span>{t.webApp}</span>
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
      </header>

      {/* 2. Navigation Tabs */}
      <nav className="shrink-0 grid grid-cols-3 border-b border-white/[0.06] bg-black/20 p-1.5 gap-1 text-[11px] font-semibold">
        <button
          type="button"
          onClick={() => setActiveTab("live")}
          className={`flex items-center justify-center gap-1.5 rounded-xl py-2 transition ${
            activeTab === "live"
              ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40 shadow-sm"
              : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.02]"
          }`}
        >
          <Crosshair className="h-3.5 w-3.5" />
          <span>{t.tabLiveSniper}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("schedule")}
          className={`flex items-center justify-center gap-1.5 rounded-xl py-2 transition ${
            activeTab === "schedule"
              ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40 shadow-sm"
              : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.02]"
          }`}
        >
          <CalendarClock className="h-3.5 w-3.5" />
          <span>{t.tabSchedule}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("tasks")}
          className={`flex items-center justify-center gap-1.5 rounded-xl py-2 transition ${
            activeTab === "tasks"
              ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40 shadow-sm"
              : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.02]"
          }`}
        >
          <ListTodo className="h-3.5 w-3.5" />
          <span>{t.tabTasks(tasks.length)}</span>
        </button>
      </nav>

      {/* 3. Tab Body Content */}
      {activeTab === "tasks" ? (
        <main className="flex-1 min-h-0 flex flex-col px-3.5 pt-3 pb-2">
          <TaskList tasks={tasks} onTasksChanged={loadTasks} lang={lang} />
        </main>
      ) : (
        <main className="flex-1 min-h-0 overflow-y-auto px-3.5 py-3 space-y-3">
          {activeTab === "live" && (
            <div className="space-y-3">
              {/* Target Drop Countdown Card */}
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-950/40 via-black/40 to-black/60 p-3.5 ring-1 ring-emerald-500/20 shadow-lg">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                    <Timer className="h-3.5 w-3.5" />
                    {t.nextDropLabel} ({String(nextDropHour).padStart(2, "0")}:00)
                  </span>
                  <span
                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold ring-1 ${
                      isWebPage
                        ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30"
                        : "bg-amber-500/10 text-amber-300 ring-amber-500/30"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        isWebPage ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
                      }`}
                    />
                    {isWebPage ? t.pageActive(activeTabDomain) : t.notOnPage}
                  </span>
                </div>

                <div className="mt-2 text-center">
                  <div className="font-mono text-[32px] font-black leading-none tracking-tight text-emerald-300 tabular-nums">
                    {countdownStr}
                  </div>
                </div>
              </div>

              {/* HERO START ACTION BUTTON */}
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={handleStartSniper}
                  className="group relative flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 py-3.5 px-4 font-black text-slate-950 shadow-xl shadow-emerald-500/25 transition hover:brightness-110 active:scale-[0.98]"
                >
                  <div className="absolute inset-0 bg-white/20 opacity-0 transition group-hover:opacity-100" />
                  <Zap className="h-5 w-5 fill-slate-950 text-slate-950" />
                  <span className="text-[13px] font-black tracking-wider uppercase">
                    {launchedToast
                      ? t.sniperActivated
                      : isWebPage
                      ? t.startOnActiveTab
                      : t.openShopeeAndStart}
                  </span>
                </button>
                <p className="text-center text-[10px] leading-snug text-slate-400 px-2">
                  {t.launchHint}
                </p>
              </div>

              {/* Clock Sync & Latency Status */}
              <TimeOffsetCard
                lang={lang}
                activeDomain={activeTabDomain}
                activeUrl={activeTabUrl}
              />
            </div>
          )}

          {activeTab === "schedule" && (
            <div className="space-y-3">
              <ScheduleForm onTaskCreated={loadTasks} lang={lang} />
            </div>
          )}
        </main>
      )}

      {/* 4. Footer */}
      <footer className="shrink-0 border-t border-white/[0.06] bg-black/40 px-3.5 py-2">
        <div className="flex items-center justify-between text-[10px] text-slate-400">
          <div className="flex items-center gap-1 min-w-0">
            {account?.signedIn ? (
              <span className="truncate text-emerald-400">
                Member: {account.email || "DealHunter"}
              </span>
            ) : (
              <span className="whitespace-nowrap">
                {t.accountNotConnected}{" "}
                <a
                  href={webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold text-emerald-400 hover:underline"
                >
                  {t.signInLink}
                </a>
              </span>
            )}
          </div>
          <span className="flex items-center gap-1 shrink-0 text-slate-500">
            <ShieldCheck className="h-3 w-3 text-emerald-500" />
            Universal Web
          </span>
        </div>
      </footer>
    </div>
  );
};
