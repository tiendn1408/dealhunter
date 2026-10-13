import { STORAGE_KEYS } from "./constants";

/**
 * Pre-reload timing: how long before the drop to reload a page so that it has finished loading,
 * with the target button usable, right around the drop. Ordinary users cannot know how fast a
 * page loads, so it is measured: every time a page with a saved target or an armed hunt loads,
 * the time from navigation start until the target button is found is recorded for that page.
 *
 *   lead = median(load) + 1.5 * spread + 150 ms safety
 *
 * spread is IQR / 1.349 (a robust sigma) with 4+ samples, a quarter of the median otherwise.
 * Without any sample the default is 750 ms (the earlier fixed value). The result is clamped to
 * [400 ms, 6 s]: below that the page cannot reload at all, above that it would load long before
 * the drop and show the old state again.
 */

export interface PageLoadSamples {
  /** Most recent first, at most MAX_SAMPLES. */
  samplesMs: number[];
  updatedAt: number;
}

export const RELOAD_TIMING = {
  DEFAULT_LEAD_MS: 750,
  MIN_LEAD_MS: 400,
  MAX_LEAD_MS: 6000,
  SAFETY_MS: 150,
  SPREAD_FACTOR: 1.5,
  MAX_SAMPLES: 10,
  /** A load slower than this is an outlier (tab in background, network hiccup) and is not kept. */
  MAX_SAMPLE_MS: 15000,
  /** Pages not visited for this long are forgotten. */
  TTL_MS: 30 * 24 * 60 * 60 * 1000,
};

/** Samples are kept per page (origin + path): load time differs between pages of one site. */
export function pageKey(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function computePreReloadLeadMs(samplesMs: number[]): number {
  const R = RELOAD_TIMING;
  const s = samplesMs.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (s.length === 0) return R.DEFAULT_LEAD_MS;
  const median = quantile(s, 0.5);
  const spread = s.length >= 4 ? (quantile(s, 0.75) - quantile(s, 0.25)) / 1.349 : median * 0.25;
  const lead = median + R.SPREAD_FACTOR * spread + R.SAFETY_MS;
  return Math.round(Math.min(R.MAX_LEAD_MS, Math.max(R.MIN_LEAD_MS, lead)));
}

type SampleStore = Record<string, PageLoadSamples>;

async function readStore(): Promise<SampleStore> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.PAGE_LOAD_SAMPLES);
  const store = data[STORAGE_KEYS.PAGE_LOAD_SAMPLES];
  return store && typeof store === "object" ? (store as SampleStore) : {};
}

class ReloadTiming {
  /** Cached lead per page key, so the (synchronous) arm path can read it. */
  private cache = new Map<string, number>();

  /** Loads the lead for a page into the cache. */
  async load(url: string): Promise<number> {
    const key = pageKey(url);
    try {
      const store = await readStore();
      const lead = computePreReloadLeadMs(store[key]?.samplesMs ?? []);
      this.cache.set(key, lead);
      return lead;
    } catch {
      return RELOAD_TIMING.DEFAULT_LEAD_MS;
    }
  }

  /** Lead for a page from the cache (default until load() has run). */
  leadFor(url: string): number {
    return this.cache.get(pageKey(url)) ?? RELOAD_TIMING.DEFAULT_LEAD_MS;
  }

  /** Records one measured load time for a page and refreshes its cached lead. */
  async record(url: string, loadMs: number): Promise<void> {
    if (!Number.isFinite(loadMs) || loadMs <= 0 || loadMs > RELOAD_TIMING.MAX_SAMPLE_MS) return;
    const key = pageKey(url);
    const now = Date.now();
    const store = await readStore();
    for (const k of Object.keys(store)) {
      if (now - (store[k]?.updatedAt ?? 0) > RELOAD_TIMING.TTL_MS) delete store[k];
    }
    const samplesMs = [Math.round(loadMs), ...(store[key]?.samplesMs ?? [])].slice(0, RELOAD_TIMING.MAX_SAMPLES);
    store[key] = { samplesMs, updatedAt: now };
    await chrome.storage.local.set({ [STORAGE_KEYS.PAGE_LOAD_SAMPLES]: store });
    this.cache.set(key, computePreReloadLeadMs(samplesMs));
  }
}

export const reloadTiming = new ReloadTiming();
