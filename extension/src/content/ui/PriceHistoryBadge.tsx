import React, { useState, useEffect } from "react";
import { shopeeAdapter } from "../adapters/shopee_adapter";
import { MESSAGE_ACTIONS } from "../../lib/constants";
import { PriceContextResponse } from "../../lib/types";
import { storage } from "../../lib/storage";
import { Language, getTranslation } from "../../lib/i18n";
import { ShieldCheck, ExternalLink, X } from "lucide-react";

/**
 * Shown only to a member signed in to DealHunter web (session handed over by the web app).
 * Signed out, the extension offers just its deal-hunting tools and this badge stays hidden.
 */
export const PriceHistoryBadge: React.FC = () => {
  const [visible, setVisible] = useState(true);
  const [response, setResponse] = useState<PriceContextResponse | null>(null);
  const [lang, setLang] = useState<Language>("en");

  const t = getTranslation(lang);

  useEffect(() => {
    storage.getLanguage().then(setLang);
    const onChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.dh_settings?.newValue?.language) {
        setLang(changes.dh_settings.newValue.language);
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  useEffect(() => {
    const fetchContext = async () => {
      const prod = shopeeAdapter.extractProductInfo();
      if (!prod || !prod.itemId) return;
      try {
        const res: PriceContextResponse = await chrome.runtime.sendMessage({
          action: MESSAGE_ACTIONS.GET_PRICE_CONTEXT,
          url: window.location.href,
        });
        setResponse(res);
      } catch {
        // Extension reloaded or service worker unavailable: show nothing
      }
    };

    // Wait slightly for DOM hydration
    const timer = setTimeout(fetchContext, 1500);
    return () => clearTimeout(timer);
  }, []);

  if (!visible || !response || !response.signedIn) return null;
  const { context: priceContext, webUrl } = response;

  return (
    <div className="bg-white/95 backdrop-blur-md border border-emerald-300 text-slate-800 rounded-2xl shadow-xl p-3 w-72 space-y-2 select-none animate-in fade-in slide-in-from-bottom-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
        <div className="flex items-center gap-1.5 text-xs font-bold text-pine-900">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>{t.priceBadgeTitle}</span>
        </div>
        <button
          type="button"
          onClick={() => setVisible(false)}
          className="text-slate-400 hover:text-slate-600 p-0.5 rounded"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {priceContext ? (
        <div className="space-y-1.5 text-xs">
          {priceContext.bestDealPlatform &&
            priceContext.bestDealPlatform !== "shopee" &&
            priceContext.bestDealPrice !== undefined && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-2 rounded-xl">
                <span className="font-bold block">
                  {t.betterDealPrefix} {priceContext.bestDealPlatform.toUpperCase()}!
                </span>
                <span>
                  {priceContext.savingsPercent !== undefined &&
                    t.cheaperBy(
                      Math.round(priceContext.savingsPercent),
                      `${priceContext.bestDealPrice.toLocaleString("vi-VN")}đ`
                    )}
                </span>
              </div>
            )}

          <div className="flex items-center justify-between text-slate-600">
            <span>{t.recordedPrice}</span>
            <span className="font-bold text-slate-900">
              {priceContext.currentPrice !== null
                ? `${priceContext.currentPrice.toLocaleString("vi-VN")}đ`
                : t.noDataYet}
            </span>
          </div>

          <a
            href={`${webUrl}/tracking/${priceContext.trackingId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 py-1.5 px-2 rounded-lg transition-colors mt-1"
          >
            <span>{t.viewHistoryWeb}</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      ) : (
        <div className="text-[11px] text-slate-500 py-1 space-y-1">
          <p>{t.notTrackingYet}</p>
          <a
            href={`${webUrl}?url=${encodeURIComponent(window.location.href)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-emerald-600 font-bold hover:underline"
          >
            <span>{t.trackPriceNow}</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
    </div>
  );
};

