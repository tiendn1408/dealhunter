/**
 * ElementResolver finds buttons across platforms and languages,
 * tracks their identity across virtual DOM / React re-renders,
 * and reads completion states reliably without rigid text coupling.
 */
export type ButtonState = "collectable" | "saved" | "exhausted" | "gone" | "unknown";

export interface UniversalTargetDescriptor {
  id?: string;
  uniqueSelector: string;
  tagName: string;
  attributes: Record<string, string>;
  initialText: string;
  childIndex?: number;
  parentSelector?: string;
  rect?: { top: number; left: number; width: number; height: number };
  documentTop?: number;
  containerText?: string;
  valueTokens?: string[];
}

export interface CompletionStatus {
  completed: boolean;
  state: ButtonState;
  reason: string;
  /** Only the button turning disabled: also happens while a request runs, so it must last longer. */
  weak?: boolean;
}

/** Identifies a voucher card independently of the button node, which React may replace at drop time. */
export interface CompletionCheckOptions {
  /** The engine removed `disabled` itself, so a disabled button again is not a completion signal. */
  ignoreDisabled?: boolean;
  /** Notifications present before the first click (see snapshotToasts). */
  toastBaseline?: Map<Element, string>;
}

export interface VoucherDescriptor {
  cardText: string; // voucher card text without the button label
}

const BUTTON_SELECTOR = 'button, div[role="button"], a[role="button"], span[role="button"], input[type="button"], input[type="submit"]';

function safeCssEscape(str: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(str);
  }
  return str.replace(/([!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, "\\$1");
}

function computeCssSelector(el: HTMLElement): string {
  if (el.id && /^[a-zA-Z][a-zA-Z0-9_\-:.]*$/.test(el.id)) {
    try {
      if (document.querySelectorAll("#" + safeCssEscape(el.id)).length === 1) {
        return "#" + safeCssEscape(el.id);
      }
    } catch {
      // ignore
    }
  }

  const testId = el.getAttribute("data-testid") || el.getAttribute("data-test-id");
  if (testId) {
    try {
      const sel = `[data-testid="${safeCssEscape(testId)}"]`;
      if (document.querySelectorAll(sel).length === 1) {
        return sel;
      }
    } catch {
      // ignore
    }
  }

  const path: string[] = [];
  let curr: HTMLElement | null = el;
  let depth = 0;

  while (curr && curr.nodeType === Node.ELEMENT_NODE && depth < 6) {
    let selector = curr.tagName.toLowerCase();
    if (curr.id && /^[a-zA-Z][a-zA-Z0-9_\-:.]*$/.test(curr.id)) {
      selector += "#" + safeCssEscape(curr.id);
      path.unshift(selector);
      break;
    }
    const parentNode: HTMLElement | null = curr.parentElement;
    if (parentNode) {
      const siblings = Array.from(parentNode.children) as HTMLElement[];
      const sameTagSiblings = siblings.filter((c) => c.tagName === curr?.tagName);
      if (sameTagSiblings.length > 1) {
        const index = sameTagSiblings.indexOf(curr) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }
    path.unshift(selector);
    curr = parentNode;
    depth++;
  }

  return path.join(" > ");
}

export function hasCompletionIcon(button: HTMLElement): boolean {
  const iconElements: HTMLElement[] = [
    button,
    ...Array.from(button.querySelectorAll<HTMLElement>("svg, i, [class*='icon'], [role='img']")),
  ];
  for (const el of iconElements) {
    const rawCls = el.getAttribute("class") || (typeof el.className === "string" ? el.className : "");
    const testId = el.getAttribute("data-testid") || "";
    const ariaLabel = el.getAttribute("aria-label") || "";
    const title = el.getAttribute("title") || "";
    const combined = `${rawCls} ${testId} ${ariaLabel} ${title}`.toLowerCase();

    // Explicitly reject ticket, checkout, checkbox
    if (/(?:ticket|checkout|checkbox)/i.test(combined)) {
      continue;
    }

    // Match check, checkmark, tick, success, done as whole words or delimited by - / _ / space
    if (/(?:^|[\s_-])(check|checkmark|tick|success|done)(?:$|[\s_-])/i.test(combined)) {
      return true;
    }
  }
  return false;
}

export function hasExhaustionIcon(element: HTMLElement): boolean {
  const iconElements: HTMLElement[] = [
    element,
    ...Array.from(element.querySelectorAll<HTMLElement>("svg, i, [class*='icon'], [role='img']")),
  ];
  for (const el of iconElements) {
    const rawCls = el.getAttribute("class") || (typeof el.className === "string" ? el.className : "");
    const testId = el.getAttribute("data-testid") || "";
    const ariaLabel = el.getAttribute("aria-label") || "";
    const title = el.getAttribute("title") || "";
    const combined = `${rawCls} ${testId} ${ariaLabel} ${title}`.toLowerCase();

    // Match warning, error, cross, times, fail, close, alert, ban, exclamation as technical tokens
    if (
      /(?:^|[\s_-])(warning|error|danger|close|cross|times|fail|alert|ban|exclamation|exhausted|depleted|is-warning|is-error|swal2-x-mark)(?:$|[\s_-])/i.test(
        combined
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Universal Chromatic Visual Tone Analysis:
 * Language-agnostic inspection of computed colors (color, backgroundColor, fill, stroke).
 * W3C / UI design conventions worldwide universally map:
 * - Green (dominant green): success / completed / confirmed
 * - Red / Amber (dominant red or orange): error / warning / exhausted / depleted
 */
export function detectVisualChromaticTone(el: HTMLElement): "success" | "exhausted" | "neutral" {
  const elements = [
    el,
    ...Array.from(
      el.querySelectorAll<HTMLElement>("svg, path, circle, i, [role='img'], [class*='icon'], [class*='badge']")
    ),
  ];
  for (const target of elements) {
    // 1. Direct SVG attributes
    const fill = target.getAttribute("fill");
    const stroke = target.getAttribute("stroke");
    const colorCandidates = [fill, stroke];

    // 2. Computed styles
    if (typeof window !== "undefined" && window.getComputedStyle) {
      try {
        const cs = window.getComputedStyle(target);
        if (cs) {
          colorCandidates.push(cs.color, cs.backgroundColor, cs.fill, cs.stroke);
        }
      } catch {
        // ignore
      }
    }

    for (const c of colorCandidates) {
      if (!c || c === "none" || c === "transparent" || c === "currentColor" || c === "inherit") continue;

      // Parse rgb/rgba
      const rgbMatch = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if (rgbMatch) {
        const r = parseInt(rgbMatch[1], 10);
        const g = parseInt(rgbMatch[2], 10);
        const b = parseInt(rgbMatch[3], 10);
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max - min >= 25) {
          if (g > 90 && g > r + 25 && g > b + 25) return "success";
          if (r > 120 && r > g + 25 && r > b + 25) return "exhausted";
          if (r > 180 && g > 100 && b < 80) return "exhausted"; // amber / warning
        }
      }

      // Parse hex #rgb or #rrggbb
      const hexMatch = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
      if (hexMatch) {
        let hex = hexMatch[1];
        if (hex.length === 3) {
          hex = hex.split("").map((ch) => ch + ch).join("");
        }
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max - min >= 25) {
          if (g > 90 && g > r + 25 && g > b + 25) return "success";
          if (r > 120 && r > g + 25 && r > b + 25) return "exhausted";
          if (r > 180 && g > 100 && b < 80) return "exhausted";
        }
      }
    }
  }
  return "neutral";
}

/**
 * Scans page-level notification banners, toasts, and dialogs (Shopee, Lazada, TikTok Shop)
 * for immediate post-click success or exhaustion confirmations using pure structural,
 * SVG icon, chromatic tone, and HTML5/W3C data contracts without language-specific dictionaries.
 */
/** Notification-like containers a site may use to confirm (or refuse) an action. */
const TOAST_SELECTORS = [
    '[role="alert"]',
    '[role="status"]',
    '[aria-live="assertive"]',
    '[aria-live="polite"]',
    // Shopee
    ".shopee-toast",
    ".shopee-alert-popup",
    // Lazada
    ".next-feedback-toast",
    ".lzd-toast",
    ".lzd-message",
    // TikTok Shop / ByteDance UI
    ".arco-message",
    ".byte-message",
    'div[class*="tiktok-toast" i]',
    // Tiki / Ant Design
    ".tiki-toast",
    ".ant-message",
    ".ant-notification",
    ".ant-modal-content",
    ".ant-modal-body",
    // SweetAlert & SweetAlert2 (widely used in Vietnamese web apps / caffiliate)
    ".swal2-container",
    ".swal2-popup",
    ".swal2-html-container",
    ".swal2-title",
    ".swal-modal",
    ".swal-text",
    // Generic dialogs & modals
    '[role="dialog"]',
    '[role="alertdialog"]',
    ".modal-content",
    ".modal-body",
    // Global & generic framework notification containers
    'div[class*="toast" i]',
    'div[class*="snackbar" i]',
    'div[class*="alert-popup" i]',
    'div[class*="floating-alert" i]',
    'div[class*="notification" i]',
    'div[class*="feedback" i]',
    'div[class*="notice" i]',
    'div[class*="popup" i]',
];

/** DealHunter's own UI, never a site notification. */
const OWN_UI_SELECTOR = "#dealhunter-hud-root, #dealhunter-badge-root, #dh-picker-overlay";

function queryToasts(): HTMLElement[] {
  try {
    return Array.from(document.querySelectorAll<HTMLElement>(TOAST_SELECTORS.join(", ")));
  } catch {
    return [];
  }
}

/**
 * Notifications already on the page (with their text) before the first click. A banner, cart
 * counter or old message that was there before we clicked says nothing about our click.
 */
export function snapshotToasts(): Map<Element, string> {
  const out = new Map<Element, string>();
  if (typeof document === "undefined") return out;
  for (const el of queryToasts()) out.set(el, (el.textContent || "").trim());
  return out;
}

export function checkPageToastConfirmation(baseline?: Map<Element, string>): CompletionStatus | null {
  if (typeof document === "undefined") return null;

  for (const el of queryToasts()) {
    if (!el.isConnected) continue;
    if (el.closest(OWN_UI_SELECTOR)) continue;
    // Unchanged since before the click: not an answer to it
    if (baseline && baseline.get(el) === (el.textContent || "").trim()) continue;

    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
    const hasDimensions = rect.width > 0 || rect.height > 0 || el.offsetWidth > 0 || el.offsetHeight > 0;
    const isTestEnv = typeof process !== "undefined" && process.env.NODE_ENV === "test";
    if (!hasDimensions && !isTestEnv) continue;

    const style = typeof window !== "undefined" && window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) {
      continue;
    }

    const rawCls = (typeof el.className === "string" ? el.className : "").toLowerCase();
    const dataType = (el.getAttribute("data-type") || el.getAttribute("data-status") || el.getAttribute("data-state") || "").toLowerCase();

    // 1. Structural icon evaluation (SVG geometry / Icon library technical tokens)
    const hasSuccessIcon = hasCompletionIcon(el);
    const hasErrorIcon = hasExhaustionIcon(el);

    // 2. Technical Framework Contracts & CSS class tokens (language-agnostic technical code)
    const hasSuccessCode =
      /^(success|positive|completed|saved|done)$/i.test(dataType) ||
      /(?:^|[\s_-])(success|is-success|positive|completed|toast-success|alert-success|swal2-success|notice-success)(?:$|[\s_-])/i.test(
        rawCls
      ) ||
      Boolean(
        el.querySelector(
          "[class*='swal2-success'], [class*='alert-success'], [class*='is-success'], [class*='toast-success'], [data-type='success'], [data-status='success'], [data-state='success']"
        )
      );

    const hasErrorCode =
      /^(error|warning|exhausted|depleted|danger|failed)$/i.test(dataType) ||
      /(?:^|[\s_-])(error|is-error|warning|is-warning|danger|toast-error|alert-error|alert-danger|exhausted|depleted|swal2-error|swal2-warning|notice-error)(?:$|[\s_-])/i.test(
        rawCls
      ) ||
      Boolean(
        el.querySelector(
          "[class*='swal2-error'], [class*='swal2-warning'], [class*='alert-danger'], [class*='alert-warning'], [class*='is-error'], [class*='is-warning'], [class*='toast-error'], [data-type='error'], [data-status='error']"
        )
      );

    // 3. Chromatic Visual Tone Analysis (Green vs Red/Amber computed styles)
    const chromaticTone = detectVisualChromaticTone(el);

    // Evaluate Exhaustion/Error first:
    if (hasErrorIcon || hasErrorCode || chromaticTone === "exhausted") {
      const reason =
        hasErrorIcon || hasErrorCode
          ? "Page notification confirmed exhausted/error via structural icon or data contract"
          : "Page notification confirmed exhausted/error via chromatic visual tone (warning/danger)";
      return {
        completed: true,
        state: "exhausted",
        reason,
      };
    }

    // Evaluate Success:
    if (hasSuccessIcon || hasSuccessCode || chromaticTone === "success") {
      const reason =
        hasSuccessIcon || hasSuccessCode
          ? "Page notification confirmed success via structural icon or data contract"
          : "Page notification confirmed success via chromatic visual tone (success/green)";
      return {
        completed: true,
        state: "saved",
        reason,
      };
    }

    // A live region merely having text (cart count, "loading", ...) is not a confirmation.
  }

  return null;
}

export class ElementResolver {
  text(el: Element | null | undefined): string {
    return ((el as HTMLElement | null)?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  /** The clickable element for a node the user pointed at (it may be an inner span/icon). */
  normalizeTarget(el: HTMLElement): HTMLElement {
    return (el.closest(BUTTON_SELECTOR) as HTMLElement | null) || el;
  }

  /** Scans the document for buttons that can still be collected/clicked. */
  findCollectButtons(keyword?: string): HTMLElement[] {
    return this.allVoucherButtons(keyword).filter((el) => this.getButtonState(el) === "collectable");
  }

  /** Every interactive button element, optionally filtered by card keyword. */
  allVoucherButtons(keyword?: string): HTMLElement[] {
    const out: HTMLElement[] = [];
    const elements = document.querySelectorAll<HTMLElement>(BUTTON_SELECTOR);
    for (const el of elements) {
      if (!el.isConnected) continue;
      if (el.style.display === "none" || el.style.visibility === "hidden" || el.hidden) continue;

      const label = this.text(el);
      if (!label && el.children.length === 0) continue;

      // Exclude HUD, badge, and overlay elements
      if (typeof el.closest === "function" && (el.closest(OWN_UI_SELECTOR) || el.closest(".dh-root"))) {
        continue;
      }

      // Filter out non-action secondary widgets (modal openers, details toggles, plain navigation links)
      if (
        el.getAttribute("aria-haspopup") === "dialog" ||
        el.getAttribute("aria-haspopup") === "true" ||
        el.hasAttribute("aria-expanded") ||
        el.hasAttribute("aria-controls") ||
        el.getAttribute("role") === "link" ||
        (el.tagName === "A" && el.hasAttribute("href"))
      ) {
        continue;
      }

      const cls = typeof el.className === "string" ? el.className : "";
      if (
        /(?:^|[\s_-])(secondary|detail|terms|condition|rules?|info|more|link|dismiss|cancel|close|help)(?:$|[\s_-])/i.test(cls)
      ) {
        continue;
      }

      // Exclude dangerous payment / purchase buttons from automatic scanning
      if (
        /(?:^|[\s_-])(checkout|buy-now|btn-buy|payment|place-order|pay)(?:$|[\s_-])/i.test(cls) ||
        /^(mua ngay|mua với voucher|mua hàng|thanh toán|đặt hàng|place order|checkout|buy now|pay now)(?![a-zà-ỹ])/i.test(label)
      ) {
        continue;
      }

      if (keyword) {
        const cardText = this.text(this.findVoucherContainer(el)).toLowerCase();
        const elText = label.toLowerCase();
        if (!cardText.includes(keyword.toLowerCase()) && !elText.includes(keyword.toLowerCase())) {
          continue;
        }
      }
      out.push(el);
    }
    return out;
  }

  /**
   * Evaluates button state based on semantic DOM attributes, CSS state classes, and standard markers.
   * Completely language-agnostic for universal sniper targets.
   */
  getButtonState(button: HTMLElement | null): ButtonState {
    if (!button || !button.isConnected) return "gone";

    // 1. Semantic ARIA completion states
    if (
      button.getAttribute("aria-pressed") === "true" ||
      button.getAttribute("aria-checked") === "true" ||
      button.getAttribute("aria-selected") === "true"
    ) {
      return "saved";
    }

    // 2. Standard HTML5 / Framework Data Contracts (exclude active state which represents tabs/toggles)
    const dataState = button.getAttribute("data-state") || "";
    const dataStatus = button.getAttribute("data-status") || "";
    if (
      /^(checked|success|completed|saved|claimed|done)$/i.test(dataState) ||
      /^(success|completed|saved|claimed|done)$/i.test(dataStatus)
    ) {
      return "saved";
    }

    // 3. Structural Icon Marker: Checkmark / Success Icon inside button (robust whole-word match)
    if (hasCompletionIcon(button)) {
      return "saved";
    }

    const cls = typeof button.className === "string" ? button.className : "";
    const card = this.findVoucherContainer(button);
    const cardCls = card && typeof card.className === "string" ? card.className : "";

    // 4. Class-based completion indicators
    if (
      /(?:^|[\s_-])(completed|success|is-saved|btn-saved|claimed|is-claimed|done|checked)(?:$|[\s_-])/i.test(cls) ||
      /(?:^|[\s_-])(completed|success|is-saved|claimed|is-claimed)(?:$|[\s_-])/i.test(cardCls)
    ) {
      return "saved";
    }

    // 5. Depletion / Out-of-quota indicators
    if (
      /(?:^|[\s_-])(exhausted|expired|soldout|sold-out|unavailable|ended|is-over|depleted|out-of-stock)(?:$|[\s_-])/i.test(cls) ||
      /(?:^|[\s_-])(exhausted|expired|soldout|sold-out|unavailable|ended|is-over|depleted|out-of-stock)(?:$|[\s_-])/i.test(cardCls)
    ) {
      return "exhausted";
    }

    // Quota 100% or stock 0 in container
    if (card) {
      const progress = card.querySelector<HTMLElement>(
        'progress[value="100"], [role="progressbar"][aria-valuenow="100"], [data-stock="0"], [data-quantity="0"]'
      );
      if (progress) {
        return "exhausted";
      }
    }

    // 6. Disabled states
    const isDisabled =
      button.hasAttribute("disabled") ||
      button.getAttribute("aria-disabled") === "true" ||
      /(?:^|[\s_-])disabled(?:$|[\s_-])/i.test(cls);

    if (isDisabled) {
      if (
        /(?:^|[\s_-])(exhausted|expired|soldout|sold-out|unavailable|ended|depleted)(?:$|[\s_-])/i.test(cardCls)
      ) {
        return "exhausted";
      }
      return "unknown";
    }

    // 7. Connected, enabled, and visible: collectable / actionable!
    return "collectable";
  }

  /**
   * Universal completion detector: purely behavioral and structural.
   * Confirms action success via stable state updates, ARIA attributes,
   * and text mutations without requiring language-specific dictionaries.
   */
  isTargetCompleted(
    button: HTMLElement | null,
    initialText?: string,
    clicksCount = 0,
    opts: CompletionCheckOptions = {}
  ): CompletionStatus {
    // 1. Target not in DOM: disconnection from DOM is NOT proof of success (could be redirect/captcha/re-render)
    if (!button || !button.isConnected) {
      return { completed: false, state: "gone", reason: "Target element not in DOM" };
    }

    const currentText = this.text(button);
    const cls = typeof button.className === "string" ? button.className : "";

    // Intermediate loading / in-flight state is not completion
    const isBusy =
      button.getAttribute("aria-busy") === "true" ||
      /(?:^|[\s_-])(loading|is-loading|spinner|busy)(?:$|[\s_-])/i.test(cls);
    if (isBusy) {
      return { completed: false, state: "collectable", reason: "Target in loading/in-flight state" };
    }

    // 2. Behavioral state transitions after clicks dispatched
    if (clicksCount > 0) {
      // 2a. Transition to disabled after click (anti-double-click / idempotency)
      // Not evidence when we removed `disabled` ourselves: the page simply restored its own lock.
      const isDisabled =
        !opts.ignoreDisabled &&
        (button.hasAttribute("disabled") ||
          button.getAttribute("aria-disabled") === "true" ||
          /(?:^|[\s_-])disabled(?:$|[\s_-])/i.test(cls));

      // 2b. Text mutation after click (ignoring clock countdowns)
      let hasTextMutated = false;
      if (initialText) {
        const cleanInitial = initialText.replace(/\d{1,2}:\d{2}(?::\d{2})?/g, "").trim();
        const cleanCurrent = currentText.replace(/\d{1,2}:\d{2}(?::\d{2})?/g, "").trim();
        if (cleanInitial && cleanCurrent && cleanInitial !== cleanCurrent) {
          hasTextMutated = true;
        }
      }

      // 2c. Checkmark or success icon added inside button after click
      const hasSuccessIcon = hasCompletionIcon(button);

      // 2d. Class mutation: button gained completed/saved/success class
      const hasCompletedClass =
        /(?:^|[\s_-])(completed|success|is-saved|btn-saved|claimed|is-claimed|done|checked)(?:$|[\s_-])/i.test(cls);

      if (isDisabled || hasTextMutated || hasSuccessIcon || hasCompletedClass) {
        const state = this.getButtonState(button);
        if (state === "exhausted") {
          return { completed: true, state: "exhausted", reason: `Target exhausted after click: "${currentText}"` };
        }
        const reason = isDisabled
          ? "Target transitioned to disabled state after click"
          : hasTextMutated
          ? `Target state mutated from "${initialText}" to "${currentText}"`
          : hasSuccessIcon
          ? "Target gained completion icon"
          : "Target gained completion style";
        const weak = isDisabled && !hasTextMutated && !hasSuccessIcon && !hasCompletedClass;
        return { completed: true, state: "saved", reason, weak };
      }

      // 2e. Card container behavioral mutation after click (language-agnostic)
      const card = this.findVoucherContainer(button);
      if (card) {
        if (hasCompletionIcon(card)) {
          return {
            completed: true,
            state: "saved",
            reason: "Voucher card gained completion icon after click",
          };
        }

        const cardState = this.getButtonState(card);
        if (cardState === "saved") {
          return {
            completed: true,
            state: "saved",
            reason: "Voucher card transitioned to saved state after click",
          };
        }
        if (cardState === "exhausted") {
          return {
            completed: true,
            state: "exhausted",
            reason: "Voucher card transitioned to exhausted state after click",
          };
        }
      }

      // 2f. Page-level toast notification confirmation (Shopee/Lazada/TikTok)
      const toastCheck = checkPageToastConfirmation(opts.toastBaseline);
      if (toastCheck) {
        return toastCheck;
      }
    }

    // 3. Static / Pre-existing state evaluation
    const currentState = this.getButtonState(button);
    if (currentState === "saved") {
      return { completed: true, state: "saved", reason: "Target marked completed by ARIA, class, or icon" };
    }
    if (currentState === "exhausted") {
      return { completed: true, state: "exhausted", reason: "Target marked exhausted by class or quota" };
    }

    return {
      completed: false,
      state: currentState,
      reason: currentState === "collectable" ? "Target active and ready" : "Target standby/unknown",
    };
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
      const cls = typeof curr.className === "string" ? curr.className.toLowerCase() : "";
      if (
        curr.getAttribute("data-testid")?.includes("voucher") ||
        curr.getAttribute("data-testid")?.includes("coupon") ||
        cls.includes("voucher") ||
        cls.includes("coupon") ||
        cls.includes("deal") ||
        cls.includes("card") ||
        cls.includes("item") ||
        cls.includes("ticket") ||
        cls.includes("mission") ||
        cls.includes("reward") ||
        cls.includes("task") ||
        curr.getAttribute("role") === "region" ||
        curr.getAttribute("role") === "article" ||
        curr.getAttribute("role") === "listitem"
      ) {
        return curr;
      }
      if (curr === document.body || curr === document.documentElement) {
        break;
      }
      curr = curr.parentElement;
      depth++;
    }
    if (button.parentElement && button.parentElement !== document.body && button.parentElement !== document.documentElement) {
      return button.parentElement;
    }
    return null;
  }

  describe(button: HTMLElement): VoucherDescriptor {
    const card = this.findVoucherContainer(button);
    const label = this.text(button);
    return { cardText: this.text(card).replace(label, "").trim() };
  }

  /**
   * Captures a comprehensive fingerprint of any element on any platform/language.
   */
  describeUniversal(button: HTMLElement): UniversalTargetDescriptor {
    const norm = this.normalizeTarget(button);
    const card = this.findVoucherContainer(norm);
    const label = this.text(norm);
    const rect = norm.getBoundingClientRect ? norm.getBoundingClientRect() : { top: 0, left: 0, width: 0, height: 0 };

    const attributes: Record<string, string> = {};
    for (const name of ["data-testid", "data-test-id", "name", "role", "type", "aria-label", "class", "title"]) {
      const val = norm.getAttribute(name);
      if (val) attributes[name] = val;
    }

    let childIndex: number | undefined;
    let parentSelector: string | undefined;
    if (norm.parentElement) {
      childIndex = Array.from(norm.parentElement.children).indexOf(norm);
      parentSelector = computeCssSelector(norm.parentElement);
    }

    const containerText = card ? this.text(card).replace(label, "").trim() : "";
    const tokens = Array.from(valueTokens(containerText));
    const scrollY = typeof window !== "undefined" ? window.scrollY : 0;
    const documentTop = Math.round(rect.top + scrollY);

    return {
      id: norm.id || undefined,
      uniqueSelector: computeCssSelector(norm),
      tagName: norm.tagName.toLowerCase(),
      attributes,
      initialText: label,
      childIndex,
      parentSelector,
      rect: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      },
      documentTop,
      containerText,
      valueTokens: tokens,
    };
  }

  /**
   * Finds the button for a previously described voucher card again.
   */
  relocate(desc: VoucherDescriptor): HTMLElement | null {
    const wanted = valueTokens(desc.cardText);
    if (wanted.size === 0) return null;
    const matches = this.allVoucherButtons().filter((el) =>
      matchesTokens(wanted, valueTokens(this.describe(el).cardText))
    );
    // Several cards with the same values: no way to tell which one, so none.
    return matches.length === 1 ? matches[0] : null;
  }

  /**
   * Whether a candidate is the same target as the descriptor, judged by content (never by position):
   * - with a card: the card's values (amounts, %, dates) and its words (shop / title) must match,
   *   so "Giảm 50k" of another shop is rejected; the button label itself may change (countdown ->
   *   "Lưu"),
   * - without any card text: the button's own label must match (digits and clocks ignored).
   */
  matchesContentSignature(candidate: HTMLElement, desc: UniversalTargetDescriptor): boolean {
    const hasTokens = Boolean(desc.valueTokens && desc.valueTokens.length > 0);
    const hasContainer = Boolean(desc.containerText && desc.containerText.trim().length > 0);

    if (!hasTokens && !hasContainer) {
      const want = labelKey(desc.initialText || "");
      const got = labelKey(this.text(candidate));
      if (want || got) return want === got;
      // Icon-only button: compare what describes it instead
      const attr = (el: HTMLElement | null, name: string) => el?.getAttribute(name) || "";
      return (
        (desc.attributes["aria-label"] || "") === attr(candidate, "aria-label") &&
        (desc.attributes["title"] || "") === attr(candidate, "title") &&
        (desc.attributes["class"] || "") === attr(candidate, "class")
      );
    }

    const card = this.findVoucherContainer(candidate);
    const cardText = card ? this.text(card).replace(this.text(candidate), "").trim() : "";
    if (!cardText) return false;

    if (hasTokens && !matchesTokens(new Set(desc.valueTokens!), valueTokens(cardText))) return false;

    if (hasContainer) {
      const wantedWords = cardWords(desc.containerText!);
      if (wantedWords.size > 0) {
        const gotWords = cardWords(cardText);
        let shared = 0;
        for (const w of wantedWords) if (gotWords.has(w)) shared++;
        // Values already matched: words may change a lot (countdown "Bắt đầu sau" -> "Đang diễn ra");
        // which of several matching cards is the picked one is decided by similarity ranking.
        return shared / wantedWords.size >= (hasTokens ? 0.4 : 0.6);
      }
      if (!hasTokens) return cardText.includes(desc.containerText!) || desc.containerText!.includes(cardText);
    }
    return true;
  }

  /**
   * Among several candidates that all match the content, takes the one at the picked position only
   * when it is clearly there (within 40px, the next one at least 120px away). Otherwise the target is
   * ambiguous and nothing is returned: better not to click than to click the wrong one.
   */
  private pickUnambiguous(candidates: HTMLElement[], desc: UniversalTargetDescriptor): HTMLElement | null {
    if (candidates.length === 1) return candidates[0];
    if (candidates.length === 0 || !desc.rect) return null;
    const scored = candidates
      .map((c) => {
        const r = c.getBoundingClientRect ? c.getBoundingClientRect() : { top: 0, left: 0 };
        return { c, d: Math.hypot(r.left - desc.rect!.left, r.top - desc.rect!.top) };
      })
      .sort((a, b) => a.d - b.d);
    return scored[0].d <= 40 && scored[1].d >= 120 ? scored[0].c : null;
  }

  /**
   * Re-locates any target button across DOM replacements, framework re-renders, or animations.
   * Uses ranked heuristics with strict content signature validation:
   * ID -> unique CSS selector -> key attributes -> DOM path -> text -> card container match.
   * Never falls back to arbitrary spatial guessing.
   */
  relocateUniversal(desc: UniversalTargetDescriptor): HTMLElement | null {
    // 1. By ID: an id the page gives only to this element identifies it even if its texts changed
    // (e.g. "Đã điểm danh #3" yesterday, "Điểm danh" today).
    if (desc.id) {
      const el = document.getElementById(desc.id);
      if (el && el.isConnected) {
        let unique = true;
        try {
          unique = document.querySelectorAll(`#${safeCssEscape(desc.id)}`).length === 1;
        } catch {
          // keep unique
        }
        const norm = this.normalizeTarget(el);
        if (unique || this.matchesContentSignature(norm, desc)) return norm;
      }
    }

    // 2. Every element that still matches the target's content. Structure (selectors, DOM path,
    // position) is only used to break ties, never on its own: after a re-render it may point at a
    // neighbour.
    const all = Array.from(document.querySelectorAll<HTMLElement>(desc.tagName || BUTTON_SELECTOR));
    const matching = new Set<HTMLElement>();
    for (const el of all) {
      if (!el.isConnected || el.closest(OWN_UI_SELECTOR)) continue;
      const norm = this.normalizeTarget(el);
      if (this.matchesContentSignature(norm, desc)) matching.add(norm);
    }
    if (matching.size <= 1) return [...matching][0] ?? null;

    // 3. Several match: keep the ones whose card and label are the most similar to the picked one
    const scored = [...matching].map((el) => ({ el, score: this.similarity(el, desc) }));
    const best = Math.max(...scored.map((x) => x.score));
    const top = scored.filter((x) => best - x.score < 1e-6).map((x) => x.el);
    if (top.length === 1) return top[0];

    // 4. Still tied: a structural hint that points at exactly one of them
    const hinted = new Set<HTMLElement>();
    const hint = (el: Element | null) => {
      if (!el) return;
      const norm = this.normalizeTarget(el as HTMLElement);
      if (top.includes(norm)) hinted.add(norm);
    };
    try {
      if (desc.uniqueSelector) hint(document.querySelector(desc.uniqueSelector));
    } catch {
      // ignore selector syntax errors
    }
    for (const attr of ["data-testid", "data-test-id", "name", "aria-label"]) {
      const val = desc.attributes[attr];
      if (!val) continue;
      try {
        document.querySelectorAll(`[${attr}="${safeCssEscape(val)}"]`).forEach(hint);
      } catch {
        // ignore
      }
    }
    if (hinted.size === 1) return [...hinted][0];

    // 5. Last: the picked position, only if unambiguous
    return this.pickUnambiguous(top, desc);
  }

  /** How close a matching candidate is to the picked target: card words (Jaccard) + same label. */
  private similarity(candidate: HTMLElement, desc: UniversalTargetDescriptor): number {
    const card = this.findVoucherContainer(candidate);
    const cardText = card ? this.text(card).replace(this.text(candidate), "").trim() : "";
    const want = cardWords(desc.containerText || "");
    const got = cardWords(cardText);
    let words = 1;
    if (want.size > 0 || got.size > 0) {
      let shared = 0;
      for (const w of want) if (got.has(w)) shared++;
      words = shared / (want.size + got.size - shared);
    }
    const sameLabel = labelKey(this.text(candidate)) === labelKey(desc.initialText || "") ? 0.5 : 0;
    return words + sameLabel;
  }
}

/**
 * Numeric values that identify a voucher (amounts, percentages, min spend, dates), extracted with a regex
 * because adjacent inline elements produce glued text ("500kBắt đầu"). Clock times ("00:00:31") change
 * every second during a countdown and are dropped.
 */
function valueTokens(text: string): Set<string> {
  const withoutClocks = text.replace(/\d{1,2}:\d{2}(?::\d{2})?/g, " ");
  const matches = withoutClocks.toLowerCase().match(/\d+(?:[.,]\d+)*(?:\s*(?:k|đ|₫|%|tr|triệu|m|b|฿|thb|rp|idr|rm|myr|₱|php|s\$|sgd|\$|€|nt\$))?/g) || [];
  return new Set(matches.map((m) => m.replace(/\s+/g, "")));
}

/** A button label without clocks, digits and spacing: "Lưu (12)" and "Lưu" are the same button. */
function labelKey(text: string): string {
  return text.replace(/\d{1,2}:\d{2}(?::\d{2})?/g, "").replace(/[\d\s.,:%()#+-]/g, "").toLowerCase();
}

/** Words of a card (shop, title, conditions), without numbers, for telling cards apart. */
function cardWords(text: string): Set<string> {
  const words = text.toLowerCase().replace(/\d{1,2}:\d{2}(?::\d{2})?/g, " ").match(/[a-zà-ỹđ]{2,}/gi) || [];
  return new Set(words);
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

export function matchesTokens(wanted: Set<string>, candidate: Set<string>): boolean {
  if (sameSet(wanted, candidate)) return true;
  if (wanted.size === 0 || candidate.size === 0) return false;

  let shared = 0;
  for (const t of wanted) {
    if (candidate.has(t)) shared++;
  }

  // All wanted tokens are present in candidate (card may have added stock % or badges)
  if (shared === wanted.size) return true;

  // Significant overlap (at least 60% of wanted tokens) and at least 2 tokens
  if (shared / wanted.size >= 0.6 && shared >= 2) return true;

  return false;
}

export const elementResolver = new ElementResolver();
