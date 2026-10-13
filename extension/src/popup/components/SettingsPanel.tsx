import React, { useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, ExternalLink, Languages, ScrollText, Trash2, UserRound, HardDrive, Info, Sparkles } from "lucide-react";
import { Language, getTranslation } from "../../lib/i18n";
import { STORAGE_KEYS } from "../../lib/constants";
import { IS_DEV_BUILD } from "../../lib/build_env";
import { getCheckInLogs } from "../../lib/checkin_log";
import { CheckInLog } from "./CheckInLog";

interface SettingsPanelProps {
  lang: Language;
  onLangChange: (lang: Language) => void;
  account: { signedIn: boolean; email?: string } | null;
  webUrl: string;
  onBack: () => void;
}

/** What "clear measurements" removes: learned clock offsets and page load times (no tasks, no targets). */
export const MEASUREMENT_KEYS = [
  STORAGE_KEYS.CLOCK_CALIBRATION,
  STORAGE_KEYS.DOMAIN_CALIBRATIONS,
  STORAGE_KEYS.PAGE_LOAD_SAMPLES,
];

const Section: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <section className="rounded-2xl bg-white/[0.03] p-3 ring-1 ring-white/10">
    <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
      {icon}
      {title}
    </h3>
    {children}
  </section>
);

/**
 * Settings page of the popup: only what an ordinary user understands (language, account, check-in
 * log, local data, version). Timings are computed by the extension, never set here.
 */
export const SettingsPanel: React.FC<SettingsPanelProps> = ({ lang, onLangChange, account, webUrl, onBack }) => {
  const t = getTranslation(lang);
  const [view, setView] = useState<"main" | "log">("main");
  const [logCount, setLogCount] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const [cleared, setCleared] = useState(false);
  const version = typeof chrome !== "undefined" && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : "";

  useEffect(() => {
    getCheckInLogs()
      .then((logs) => setLogCount(logs.length))
      .catch(() => setLogCount(0));
  }, [view]);

  const clearMeasurements = async () => {
    await chrome.storage.local.remove(MEASUREMENT_KEYS);
    setConfirmClear(false);
    setCleared(true);
  };

  const header = (
    <div className="mb-3 flex items-center gap-2">
      <button
        type="button"
        onClick={view === "log" ? () => setView("main") : onBack}
        aria-label={t.settingsBack}
        title={t.settingsBack}
        className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 text-slate-300 ring-1 ring-white/10 transition hover:bg-white/10"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
      </button>
      <h2 className="text-[14px] font-bold text-white">{view === "log" ? t.checkInLogTitle : t.settingsTitle}</h2>
    </div>
  );

  if (view === "log") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {header}
        <div className="flex-1 min-h-0">
          <CheckInLog lang={lang} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {header}

      <Section icon={<Languages className="h-3 w-3" />} title={t.settingsLanguage}>
        <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label={t.settingsLanguage}>
          {(
            [
              ["vi", "Tiếng Việt"],
              ["en", "English"],
            ] as const
          ).map(([code, label]) => (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={lang === code}
              onClick={() => onLangChange(code)}
              className={`rounded-xl py-2 text-[12px] font-semibold transition ${
                lang === code
                  ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40"
                  : "bg-black/30 text-slate-300 ring-1 ring-white/10 hover:bg-white/[0.06]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Section>

      <Section icon={<UserRound className="h-3 w-3" />} title={t.settingsAccount}>
        <div className="flex items-center justify-between gap-2">
          <span className={`truncate text-[12px] ${account?.signedIn ? "text-emerald-300" : "text-slate-400"}`}>
            {account?.signedIn ? t.memberLabel(account.email || "DealHunter") : t.accountNotConnected}
          </span>
          <a
            href={webUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex shrink-0 items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-200 ring-1 ring-white/10 transition hover:bg-white/10"
          >
            {account?.signedIn ? t.settingsOpenWeb : t.signInLink}
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
        {!account?.signedIn && <p className="mt-1.5 text-[10px] leading-snug text-slate-500">{t.settingsAccountHint}</p>}
      </Section>

      <button
        type="button"
        onClick={() => setView("log")}
        className="flex w-full items-center justify-between rounded-2xl bg-white/[0.03] p-3 text-left ring-1 ring-white/10 transition hover:bg-white/[0.06]"
      >
        <span className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-emerald-400" />
          <span>
            <span className="block text-[12px] font-semibold text-slate-100">{t.checkInLogTitle}</span>
            <span className="block text-[10px] text-slate-500">{t.settingsLogCount(logCount)}</span>
          </span>
        </span>
        <ChevronRight className="h-4 w-4 text-slate-500" />
      </button>

      <button
        type="button"
        onClick={() => {
          chrome.storage.local.remove(STORAGE_KEYS.ONBOARDING_DONE).catch(() => {});
          onBack();
        }}
        className="flex w-full items-center justify-between rounded-2xl bg-white/[0.03] p-3 text-left ring-1 ring-white/10 transition hover:bg-white/[0.06]"
      >
        <span className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-emerald-400" />
          <span className="text-[12px] font-semibold text-slate-100">{t.settingsShowGuide}</span>
        </span>
        <ChevronRight className="h-4 w-4 text-slate-500" />
      </button>

      <Section icon={<HardDrive className="h-3 w-3" />} title={t.settingsLocalData}>
        <p className="mb-2 text-[10px] leading-snug text-slate-500">{t.settingsLocalDataHint}</p>
        {confirmClear ? (
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={clearMeasurements}
              className="rounded-xl bg-rose-500/15 py-2 text-[11px] font-semibold text-rose-300 ring-1 ring-rose-500/40 transition hover:bg-rose-500/25"
            >
              {t.settingsClearConfirm}
            </button>
            <button
              type="button"
              onClick={() => setConfirmClear(false)}
              className="rounded-xl bg-white/5 py-2 text-[11px] font-semibold text-slate-300 ring-1 ring-white/10 transition hover:bg-white/10"
            >
              {t.settingsCancel}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setCleared(false);
              setConfirmClear(true);
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-white/5 py-2 text-[11px] font-semibold text-slate-300 ring-1 ring-white/10 transition hover:bg-white/10"
          >
            <Trash2 className="h-3 w-3" />
            {cleared ? t.settingsCleared : t.settingsClearMeasurements}
          </button>
        )}
      </Section>

      <div className="flex items-center justify-center gap-1.5 pt-1 text-[10px] text-slate-500">
        <Info className="h-3 w-3" />
        {t.settingsVersion(version, IS_DEV_BUILD)}
      </div>
    </div>
  );
};
