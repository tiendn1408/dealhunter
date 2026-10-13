import React, { useEffect, useState } from "react";
import { Trash2, CheckCircle2, XCircle } from "lucide-react";
import { STORAGE_KEYS } from "../../lib/constants";
import { CheckInLogEntry, clearCheckInLogs, getCheckInLogs } from "../../lib/checkin_log";
import { Language, getTranslation } from "../../lib/i18n";

interface CheckInLogProps {
  lang?: Language;
}

function formatDay(serverMs: number): string {
  const d = new Date(serverMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export const CheckInLog: React.FC<CheckInLogProps> = ({ lang = "en" }) => {
  const t = getTranslation(lang);
  const [logs, setLogs] = useState<CheckInLogEntry[]>([]);

  useEffect(() => {
    const load = () => getCheckInLogs().then(setLogs).catch(() => setLogs([]));
    load();
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes[STORAGE_KEYS.CHECKIN_LOGS]) load();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[12px] font-bold text-slate-200">{t.checkInLogTitle}</div>
          <div className="text-[10px] leading-snug text-slate-500">{t.checkInLogHint}</div>
        </div>
        {logs.length > 0 && (
          <button
            type="button"
            onClick={() => clearCheckInLogs().then(() => setLogs([]))}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-white/[0.05] px-2 py-1 text-[10px] font-semibold text-slate-300 ring-1 ring-white/10 transition hover:bg-white/[0.12]"
          >
            <Trash2 className="h-3 w-3" />
            {t.checkInLogClear}
          </button>
        )}
      </div>

      {logs.length === 0 ? (
        <div className="rounded-xl bg-black/20 p-4 text-center text-[11px] text-slate-500 ring-1 ring-white/[0.06]">
          {t.checkInLogEmpty}
        </div>
      ) : (
        <ul className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-0.5">
          {logs.map((log) => (
            <li key={`${log.at}-${log.host}`} className="rounded-xl bg-black/25 p-2.5 ring-1 ring-white/[0.06]">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`flex items-center gap-1 text-[11px] font-bold ${
                    log.ok ? "text-emerald-300" : "text-rose-300"
                  }`}
                >
                  {log.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                  {log.ok ? t.checkInLogOk : t.checkInLogFailed}
                  {log.source === "manual" && <span className="font-normal text-slate-400">· {t.checkInLogManual}</span>}
                </span>
                <span className="font-mono text-[10px] text-slate-400 tabular-nums">{formatDay(log.at)}</span>
              </div>
              {(log.method || log.error) && (
                <div className="mt-0.5 truncate text-[10px] text-slate-400" title={log.error ?? log.method ?? ""}>
                  {log.ok ? log.method : log.error}
                </div>
              )}

              <table className="mt-1.5 w-full table-fixed text-[10px] text-slate-300">
                <tbody>
                  {log.attempts.map((a) => (
                    <tr key={a.n} className="border-t border-white/[0.05] align-top">
                      <td className="w-[46px] py-1 font-semibold text-slate-400">{t.checkInLogAttempt(a.n)}</td>
                      <td className="py-1">
                        <div className="font-mono tabular-nums text-slate-200">{a.start}</div>
                        <div className="text-slate-400">
                          {a.tiers
                            .map((tier) => `${t.checkInLogTier(tier.tier)}${tier.ok ? "" : " ✗"}`)
                            .join(" → ")}
                        </div>
                        {a.tiers
                          .filter((tier) => !tier.ok && tier.error)
                          .map((tier, i) => (
                            <div key={i} className="truncate text-rose-300/80" title={tier.error}>
                              {t.checkInLogTier(tier.tier)}: {tier.error}
                            </div>
                          ))}
                      </td>
                      <td className="w-[112px] py-1 text-right font-mono tabular-nums">
                        {a.tokenMs !== null && (
                          <div className={a.tokenError ? "text-rose-300" : "text-amber-300"}>Turnstile {a.tokenMs}ms</div>
                        )}
                        {a.sent && (
                          <div>
                            {a.sent} <span className="text-slate-500">+{a.sentAfterMs}</span>
                          </div>
                        )}
                        {a.serverMs !== null && (
                          <div className="text-sky-300">
                            {a.serverMs}ms · {a.status ?? "?"}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
