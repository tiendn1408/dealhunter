/**
 * ElementResolver uses a resilient 4-tier strategy to find Shopee voucher buttons
 * regardless of dynamic React class name hashing.
 */
export class ElementResolver {
  private collectButtonRegex = /^(Lưu|Lưu mã|Lưu ngay|Thu thập|Thu thập ngay|Lưu trước|Nhận|Nhận ngay|Áp dụng)($|\s|\()/i;
  private collectedStatusRegex = /(Đã lưu|Đã nhận|Dùng ngay|Hết lượt|Đã hết|Hết mã)/i;

  /**
   * Scans document for eligible voucher collect buttons.
   */
  findCollectButtons(keyword?: string): HTMLElement[] {
    const candidates: HTMLElement[] = [];
    const elements = document.querySelectorAll<HTMLElement>(
      'button, div[role="button"], a[role="button"], span[role="button"]'
    );

    for (const el of elements) {
      const rawText = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      if (!rawText) continue;

      // Skip buttons that are already collected or disabled
      if (this.collectedStatusRegex.test(rawText)) continue;
      if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") continue;

      // Match collect button patterns
      if (this.collectButtonRegex.test(rawText)) {
        if (!keyword) {
          candidates.push(el);
        } else {
          // If keyword is specified (e.g. "500k", "15%"), check if parent container has this keyword
          const container = this.findVoucherContainer(el);
          const containerText = (container?.innerText || "").toLowerCase();
          if (containerText.includes(keyword.toLowerCase())) {
            candidates.push(el);
          }
        }
      }
    }

    return candidates;
  }

  /**
   * Finds the surrounding voucher card container for an element.
   */
  findVoucherContainer(button: HTMLElement): HTMLElement | null {
    let curr: HTMLElement | null = button;
    let depth = 0;
    while (curr && depth < 6) {
      if (
        curr.getAttribute("data-testid")?.includes("voucher") ||
        curr.className.includes("voucher") ||
        curr.className.includes("card") ||
        curr.getAttribute("role") === "region"
      ) {
        return curr;
      }
      curr = curr.parentElement;
      depth++;
    }
    return button.parentElement;
  }

  /**
   * Checks if button has transitioned to a collected or exhausted state.
   */
  isButtonFinished(button: HTMLElement): boolean {
    if (!button || !button.isConnected) return true;
    const text = (button.innerText || button.textContent || "").trim();
    if (this.collectedStatusRegex.test(text)) return true;

    // Check disabled attribute or aria-disabled
    if (
      button.hasAttribute("disabled") ||
      button.getAttribute("aria-disabled") === "true" ||
      button.classList.contains("disabled")
    ) {
      return true;
    }

    return false;
  }
}

export const elementResolver = new ElementResolver();
