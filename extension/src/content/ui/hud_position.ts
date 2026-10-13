import { STORAGE_KEYS } from "../../lib/constants";

/**
 * Where the hunt panel sits: the screen corner it is closest to and the distance from it. Anchoring
 * to the nearest corner keeps the panel / minimized pill in that corner when its size changes
 * (minimize, expand, messages), instead of growing from its top-left.
 */
export interface HudAnchor {
  side: "left" | "right";
  x: number;
  edge: "top" | "bottom";
  y: number;
}

const MARGIN = 8;

/** Default: bottom-right corner, as in style.css. */
export const DEFAULT_ANCHOR: HudAnchor = { side: "right", x: 24, edge: "bottom", y: 24 };

export function anchorFromRect(rect: { left: number; top: number; width: number; height: number }, vw: number, vh: number): HudAnchor {
  const side = rect.left + rect.width / 2 > vw / 2 ? "right" : "left";
  const edge = rect.top + rect.height / 2 > vh / 2 ? "bottom" : "top";
  return {
    side,
    x: Math.max(MARGIN, Math.round(side === "right" ? vw - rect.left - rect.width : rect.left)),
    edge,
    y: Math.max(MARGIN, Math.round(edge === "bottom" ? vh - rect.top - rect.height : rect.top)),
  };
}

/** Keeps the whole element on screen (a small window, or the pill expanding into the full panel). */
export function clampAnchor(a: HudAnchor, width: number, height: number, vw: number, vh: number): HudAnchor {
  return {
    ...a,
    x: Math.max(MARGIN, Math.min(a.x, vw - width - MARGIN)),
    y: Math.max(MARGIN, Math.min(a.y, vh - height - MARGIN)),
  };
}

export function applyAnchor(el: HTMLElement, a: HudAnchor): void {
  const set = (prop: string, value: string) => el.style.setProperty(prop, value, "important");
  set(a.side, `${a.x}px`);
  set(a.side === "left" ? "right" : "left", "auto");
  set(a.edge, `${a.y}px`);
  set(a.edge === "top" ? "bottom" : "top", "auto");
}

function isAnchor(v: unknown): v is HudAnchor {
  const a = v as HudAnchor;
  return (
    !!a &&
    (a.side === "left" || a.side === "right") &&
    (a.edge === "top" || a.edge === "bottom") &&
    Number.isFinite(a.x) &&
    Number.isFinite(a.y)
  );
}

export async function loadHudAnchor(): Promise<HudAnchor | null> {
  try {
    const v = (await chrome.storage.local.get(STORAGE_KEYS.HUD_ANCHOR))[STORAGE_KEYS.HUD_ANCHOR];
    return isAnchor(v) ? v : null;
  } catch {
    return null;
  }
}

export async function saveHudAnchor(a: HudAnchor): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.HUD_ANCHOR]: a });
  } catch {
    // orphaned script / storage unavailable: the position just is not remembered
  }
}
