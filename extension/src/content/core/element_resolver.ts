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
  containerText?: string;
  valueTokens?: string[];
}

export interface CompletionStatus {
  completed: boolean;
  state: ButtonState;
  reason: string;
}

/** Identifies a voucher card independently of the button node, which React may replace at drop time. */
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

    // 2. Standard HTML5 / Framework Data Contracts
    const dataState = button.getAttribute("data-state") || "";
    const dataStatus = button.getAttribute("data-status") || "";
    if (
      /^(checked|success|completed|saved|claimed|done|active)$/i.test(dataState) ||
      /^(success|completed|saved|claimed|done)$/i.test(dataStatus)
    ) {
      return "saved";
    }

    // 3. Structural Icon Marker: Checkmark / Success Icon inside button
    const hasSuccessIcon = Boolean(
      button.querySelector(
        'svg[class*="check" i], svg[class*="success" i], svg[class*="done" i], [class*="icon-check" i], [class*="icon-success" i], [class*="tick" i]'
      )
    );
    if (hasSuccessIcon) {
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
   * Confirms action success via DOM removal, disabled transitions, ARIA state updates,
   * and text mutations without requiring language-specific dictionaries.
   */
  isTargetCompleted(button: HTMLElement | null, initialText?: string, clicksCount = 0): CompletionStatus {
    // 1. DOM removal / Consumption after click
    if (!button || !button.isConnected) {
      if (clicksCount > 0) {
        return { completed: true, state: "saved", reason: "Target element consumed/removed from DOM after click" };
      }
      return { completed: false, state: "gone", reason: "Target element not in DOM" };
    }

    const currentText = this.text(button);
    const cls = typeof button.className === "string" ? button.className : "";

    // 2. Behavioral state transitions after clicks dispatched
    if (clicksCount > 0) {
      // 2a. Transition to disabled after click (anti-double-click / idempotency)
      const isDisabled =
        button.hasAttribute("disabled") ||
        button.getAttribute("aria-disabled") === "true" ||
        /(?:^|[\s_-])disabled(?:$|[\s_-])/i.test(cls);

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
      const hasSuccessIcon = Boolean(
        button.querySelector(
          'svg[class*="check" i], svg[class*="success" i], svg[class*="done" i], [class*="icon-check" i], [class*="icon-success" i], [class*="tick" i]'
        )
      );

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
        return { completed: true, state: "saved", reason };
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
        cls.includes("voucher") ||
        cls.includes("card") ||
        cls.includes("mission") ||
        cls.includes("reward") ||
        cls.includes("task") ||
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
    for (const el of this.allVoucherButtons()) {
      if (sameSet(wanted, valueTokens(this.describe(el).cardText))) return el;
    }
    return null;
  }

  /**
   * Re-locates any target button across DOM replacements, framework re-renders, or animations.
   * Uses ranked heuristics: ID -> unique CSS selector -> key attributes -> DOM path -> text -> geometry.
   */
  relocateUniversal(desc: UniversalTargetDescriptor): HTMLElement | null {
    // 1. By ID
    if (desc.id) {
      const el = document.getElementById(desc.id);
      if (el && el.isConnected) return this.normalizeTarget(el);
    }

    // 2. By uniqueSelector
    if (desc.uniqueSelector) {
      try {
        const el = document.querySelector<HTMLElement>(desc.uniqueSelector);
        if (el && el.isConnected) return this.normalizeTarget(el);
      } catch {
        // ignore selector syntax errors
      }
    }

    // 3. By specific unique attributes
    for (const attr of ["data-testid", "data-test-id", "name", "aria-label"]) {
      const val = desc.attributes[attr];
      if (val) {
        try {
          const el = document.querySelector<HTMLElement>(`[${attr}="${safeCssEscape(val)}"]`);
          if (el && el.isConnected) return this.normalizeTarget(el);
        } catch {
          // ignore
        }
      }
    }

    // 4. By parentSelector + childIndex
    if (desc.parentSelector && typeof desc.childIndex === "number") {
      try {
        const parent = document.querySelector(desc.parentSelector);
        if (parent && parent.children[desc.childIndex]) {
          const el = parent.children[desc.childIndex] as HTMLElement;
          if (el && el.isConnected) return this.normalizeTarget(el);
        }
      } catch {
        // ignore
      }
    }
    const all = document.querySelectorAll<HTMLElement>(desc.tagName || BUTTON_SELECTOR);

    // 5. By tag name + initial text match (only if container or context matches)
    const candidates: HTMLElement[] = [];
    for (const el of all) {
      if (!el.isConnected) continue;
      const txt = this.text(el);
      if (txt && desc.initialText && txt === desc.initialText) {
        if (desc.id && el.id && desc.id !== el.id && !desc.containerText) {
          continue;
        }
        if (desc.containerText) {
          const card = this.findVoucherContainer(el);
          const cardText = card ? this.text(card).replace(txt, "").trim() : "";
          if (desc.valueTokens && desc.valueTokens.length > 0) {
            const wanted = new Set(desc.valueTokens);
            if (!sameSet(wanted, valueTokens(cardText))) {
              continue;
            }
          } else if (!cardText.includes(desc.containerText) && !desc.containerText.includes(cardText)) {
            continue;
          }
        }
        candidates.push(this.normalizeTarget(el));
      }
    }

    if (candidates.length === 1) {
      return candidates[0];
    }

    if (candidates.length > 1 && desc.rect) {
      let closest: HTMLElement = candidates[0];
      let minDist = Infinity;
      for (const c of candidates) {
        const r = c.getBoundingClientRect ? c.getBoundingClientRect() : { top: 0, left: 0 };
        const dist = Math.hypot(r.left - desc.rect.left, r.top - desc.rect.top);
        if (dist < minDist) {
          minDist = dist;
          closest = c;
        }
      }
      return closest;
    }

    // 5b. Language-agnostic fallback: when button text changed between states
    if (candidates.length === 0 && desc.rect) {
      const spatialCandidates: HTMLElement[] = [];
      for (const el of all) {
        if (!el.isConnected) continue;
        const r = el.getBoundingClientRect ? el.getBoundingClientRect() : { top: 0, left: 0, width: 0, height: 0 };
        if (r.width <= 0 || r.height <= 0) continue;

        if (desc.containerText) {
          const card = this.findVoucherContainer(el);
          const cardText = card ? this.text(card).replace(this.text(el), "").trim() : "";
          if (desc.valueTokens && desc.valueTokens.length > 0) {
            const wanted = new Set(desc.valueTokens);
            if (!sameSet(wanted, valueTokens(cardText))) {
              continue;
            }
          } else if (!cardText.includes(desc.containerText) && !desc.containerText.includes(cardText)) {
            continue;
          }
        }

        const dist = Math.hypot(r.left - desc.rect.left, r.top - desc.rect.top);
        if (dist < 150) {
          spatialCandidates.push(this.normalizeTarget(el));
        }
      }

      if (spatialCandidates.length > 0) {
        let closest = spatialCandidates[0];
        let minDist = Infinity;
        for (const c of spatialCandidates) {
          const r = c.getBoundingClientRect ? c.getBoundingClientRect() : { top: 0, left: 0 };
          const dist = Math.hypot(r.left - desc.rect.left, r.top - desc.rect.top);
          if (dist < minDist) {
            minDist = dist;
            closest = c;
          }
        }
        return closest;
      }
    }

    // 6. Fallback to voucher or container relocation if value tokens exist
    if (desc.containerText && desc.valueTokens && desc.valueTokens.length > 0) {
      const voucherMatch = this.relocate({ cardText: desc.containerText });
      if (voucherMatch) return voucherMatch;

      const wanted = new Set(desc.valueTokens);
      for (const el of all) {
        const card = this.findVoucherContainer(el);
        if (card && sameSet(wanted, valueTokens(this.text(card)))) {
          return this.normalizeTarget(el);
        }
      }
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
