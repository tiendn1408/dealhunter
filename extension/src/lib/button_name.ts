/**
 * A readable name for a chosen button, shown in the panel, the popup and the hunt list. Icon-only
 * buttons ("≣", "×", an SVG) are named by their accessible label instead of the symbol; empty when
 * nothing readable exists (callers then show "Chosen button").
 */
/** The text if it has a letter or digit, else "". */
export const readable = (s: string | null | undefined) => {
  const text = (s || "").replace(/\s+/g, " ").trim();
  return /[\p{L}\p{N}]/u.test(text) ? text : "";
};

export function buttonName(el: HTMLElement, initialText?: string, max = 30): string {
  const inner = el.querySelector("[aria-label], [title], img[alt], svg title");
  const name =
    readable(initialText) ||
    readable(el.innerText || el.textContent) ||
    readable(el.getAttribute("aria-label")) ||
    readable(el.getAttribute("title")) ||
    readable(inner?.getAttribute("aria-label")) ||
    readable(inner?.getAttribute("title")) ||
    readable(inner?.getAttribute("alt")) ||
    readable(inner?.tagName.toLowerCase() === "title" ? inner.textContent : "");
  return name.length > max ? `${name.slice(0, max)}…` : name;
}
