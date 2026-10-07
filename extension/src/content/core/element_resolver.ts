/**
 * ElementResolver finds Shopee voucher buttons by their visible text (class names are hashed and change
 * between deploys) and reads their state.
 */
export type ButtonState = "collectable" | "saved" | "exhausted" | "gone" | "unknown";

/** Identifies a voucher card independently of the button node, which React may replace at drop time. */
export interface VoucherDescriptor {
  cardText: string; // voucher card text without the button label
}

const BUTTON_SELECTOR = 'button, div[role="button"], a[role="button"], span[role="button"]';

export class ElementResolver {
  private collectButtonRegex = /^(Lưu|Lưu mã|Lưu ngay|Thu thập|Thu thập ngay|Lưu trước|Nhận|Nhận ngay|Áp dụng)($|\s|\()/i;
  private savedRegex = /(Đã lưu|Đã nhận|Dùng ngay|Dùng sau|Đã thu thập)/i;
  private exhaustedRegex = /(Hết lượt|Đã hết|Hết mã|Hết hạn|Đã kết thúc)/i;

  private text(el: Element | null | undefined): string {
    return ((el as HTMLElement | null)?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  /** The clickable element for a node the user pointed at (it may be an inner span/icon). */
  normalizeTarget(el: HTMLElement): HTMLElement {
    return (el.closest(BUTTON_SELECTOR) as HTMLElement | null) || el;
  }

  /** Scans the document for voucher buttons that can still be collected. */
  findCollectButtons(keyword?: string): HTMLElement[] {
    return this.allVoucherButtons(keyword).filter((el) => this.getButtonState(el) === "collectable");
  }

  /** Every voucher button (collectable, saved or exhausted), optionally filtered by card keyword. */
  allVoucherButtons(keyword?: string): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(BUTTON_SELECTOR)) {
      const label = this.text(el);
      if (!label) continue;
      if (!this.collectButtonRegex.test(label) && !this.savedRegex.test(label) && !this.exhaustedRegex.test(label)) {
        continue;
      }
      if (keyword) {
        const cardText = this.text(this.findVoucherContainer(el)).toLowerCase();
        if (!cardText.includes(keyword.toLowerCase())) continue;
      }
      out.push(el);
    }
    return out;
  }

  getButtonState(button: HTMLElement | null): ButtonState {
    if (!button || !button.isConnected) return "gone";
    const label = this.text(button);
    if (this.savedRegex.test(label)) return "saved";
    if (this.exhaustedRegex.test(label)) return "exhausted";
    if (
      button.hasAttribute("disabled") ||
      button.getAttribute("aria-disabled") === "true" ||
      button.classList.contains("disabled")
    ) {
      // A disabled "Lưu" before the drop is not finished; the card text tells if it ran out
      const cardText = this.text(this.findVoucherContainer(button));
      return this.exhaustedRegex.test(cardText) ? "exhausted" : "unknown";
    }
    if (this.collectButtonRegex.test(label)) return "collectable";
    return "unknown";
  }

  /** Kept for callers that only need "stop clicking": saved, exhausted or removed. */
  isButtonFinished(button: HTMLElement): boolean {
    const state = this.getButtonState(button);
    return state === "saved" || state === "exhausted" || state === "gone";
  }

  /** Finds the surrounding voucher card container for an element. */
  findVoucherContainer(button: HTMLElement): HTMLElement | null {
    let curr: HTMLElement | null = button;
    let depth = 0;
    while (curr && depth < 6) {
      const cls = typeof curr.className === "string" ? curr.className : "";
      if (
        curr.getAttribute("data-testid")?.includes("voucher") ||
        cls.includes("voucher") ||
        cls.includes("card") ||
        curr.getAttribute("role") === "region"
      ) {
        return curr;
      }
      curr = curr.parentElement;
      depth++;
    }
    return button.parentElement;
  }

  describe(button: HTMLElement): VoucherDescriptor {
    const card = this.findVoucherContainer(button);
    const label = this.text(button);
    return { cardText: this.text(card).replace(label, "").trim() };
  }

  /**
   * Finds the button for a previously described voucher card again (React often swaps the node when
   * the countdown ends). Cards are matched by their value tokens ("50k", "500k", "15%"...), which identify
   * a voucher, ignoring clock-like tokens ("00:00:31") that change every second. Returns null when the
   * card is not on the page; callers must never substitute a different voucher.
   */
  relocate(desc: VoucherDescriptor): HTMLElement | null {
    const wanted = valueTokens(desc.cardText);
    if (wanted.size === 0) return null;
    for (const el of this.allVoucherButtons()) {
      if (sameSet(wanted, valueTokens(this.describe(el).cardText))) return el;
    }
    return null;
  }
}

/**
 * Numeric values that identify a voucher (amounts, percentages, min spend, dates), extracted with a regex
 * because adjacent inline elements produce glued text ("500kBắt đầu"). Clock times ("00:00:31") change
 * every second during a countdown and are dropped.
 */
function valueTokens(text: string): Set<string> {
  const withoutClocks = text.replace(/\d{1,2}:\d{2}(?::\d{2})?/g, " ");
  const matches = withoutClocks.toLowerCase().match(/\d+(?:[.,]\d+)*\s*(?:k|đ|₫|%|tr|triệu)?/g) || [];
  return new Set(matches.map((m) => m.replace(/\s+/g, "")));
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

export const elementResolver = new ElementResolver();
