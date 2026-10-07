import React, { useState, useEffect } from "react";
import { shopeeAdapter } from "../adapters/shopee_adapter";
import { apiClient } from "../../lib/api_client";
import { ProductPriceContext } from "../../lib/types";
import { TrendingDown, ShieldCheck, ExternalLink, X, ShoppingBag } from "lucide-react";

export const PriceHistoryBadge: React.FC = () => {
  const [visible, setVisible] = useState(true);
  const [priceContext, setPriceContext] = useState<ProductPriceContext | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchContext = async () => {
      const prod = shopeeAdapter.extractProductInfo();
      if (!prod || !prod.itemId) {
        setLoading(false);
        return;
      }

      const ctx = await apiClient.getProductPriceContext(window.location.href);
      setPriceContext(ctx);
      setLoading(false);
    };

    // Wait slightly for DOM hydration
    const timer = setTimeout(fetchContext, 1500);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;
  if (loading) return null;

  return (
    <div className="bg-white/95 backdrop-blur-md border border-emerald-300 text-slate-800 rounded-2xl shadow-xl p-3 w-72 space-y-2 select-none animate-in fade-in slide-in-from-bottom-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
        <div className="flex items-center gap-1.5 text-xs font-bold text-pine-900">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>DealHunter Intelligence</span>
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
          {priceContext.bestDealPlatform && priceContext.bestDealPlatform !== "shopee" && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-2 rounded-xl">
              <span className="font-bold block">Gia tot hon tren {priceContext.bestDealPlatform.toUpperCase()}!</span>
              <span>
                Re hon {priceContext.savingsPercent}% (Chi con {priceContext.bestDealPrice?.toLocaleString("vi-VN")}d)
              </span>
            </div>
          )}

          {priceContext.lowestPrice30d && (
            <div className="flex items-center justify-between text-slate-600">
              <span>Day 30 ngay:</span>
              <span className="font-bold text-slate-900">
                {priceContext.lowestPrice30d.toLocaleString("vi-VN")}d
              </span>
            </div>
          )}

          <a
            href={`http://localhost:3000/tracking/${priceContext.productId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 py-1.5 px-2 rounded-lg transition-colors mt-1"
          >
            <span>Xem lich su gia tren Web</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      ) : (
        <div className="text-[11px] text-slate-500 py-1 space-y-1">
          <p>San pham chua co tren DealHunter.</p>
          <a
            href={`http://localhost:3000?url=${encodeURIComponent(window.location.href)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-emerald-600 font-bold hover:underline"
          >
            <span>Theo doi gia ngay</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
    </div>
  );
};
