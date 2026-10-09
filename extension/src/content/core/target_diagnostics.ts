import { elementResolver } from "./element_resolver";
import { TargetDiagnosticsSummary, ReloadStrategy, PageFramework } from "../../lib/types";

export class TargetDiagnostics {
  private countdownRegex = /\b(\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2})\b/;

  /**
   * Detects frontend framework used on the page or ancestor DOM tree.
   */
  detectFramework(el: HTMLElement): PageFramework {
    let curr: HTMLElement | null = el;
    let depth = 0;

    while (curr && depth < 8) {
      const keys = Object.keys(curr);
      if (keys.some((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactProps$"))) {
        return "react";
      }
      if (keys.some((k) => k.startsWith("__vue") || k === "__vue_app__")) {
        return "vue";
      }
      if (Array.from(curr.attributes || []).some((a) => a.name.startsWith("data-v-") || a.name === "data-v-app")) {
        return "vue";
      }
      if (curr.hasAttribute("ng-version") || curr.hasAttribute("ng-app")) {
        return "angular";
      }
      if (typeof curr.className === "string" && curr.className.includes("svelte-")) {
        return "svelte";
      }
      curr = curr.parentElement;
      depth++;
    }

    if (typeof document !== "undefined") {
      if (
        document.querySelector("[data-reactroot]") ||
        Object.keys(document.body || {}).some((k) => k.startsWith("__react"))
      ) {
        return "react";
      }
      if (document.querySelector("[data-v-]") || document.querySelector("#app[data-v-app]")) {
        return "vue";
      }
      if (document.querySelector("[ng-version]")) {
        return "angular";
      }
    }

    return "unknown";
  }

  /**
   * Locates in-DOM countdown text inside the target element or its surrounding voucher/section container.
   */
  findCountdownSnippet(el: HTMLElement): { snippet?: string; element?: HTMLElement } {
    const container = elementResolver.findVoucherContainer(el) || el.parentElement || el;

    // Check timer / countdown labeled elements first
    const timerCandidates = container.querySelectorAll<HTMLElement>(
      '[class*="countdown"], [class*="timer"], [data-testid*="countdown"], [data-testid*="timer"], time'
    );
    for (const cand of timerCandidates) {
      const txt = elementResolver.text(cand);
      const match = txt.match(this.countdownRegex);
      if (match) {
        return { snippet: match[1], element: cand };
      }
    }

    // Fallback: search all child elements in container for time format
    const all = container.querySelectorAll<HTMLElement>("*");
    for (const child of all) {
      if (child.children.length === 0) {
        const txt = elementResolver.text(child);
        const match = txt.match(this.countdownRegex);
        if (match) {
          return { snippet: match[1], element: child };
        }
      }
    }

    return {};
  }

  /**
   * Checks whether the target element is currently in a standby/upcoming state (has countdown timer, is disabled, or upcoming status).
   */
  isStandbyState(el: HTMLElement): boolean {
    const { snippet } = this.findCountdownSnippet(el);
    if (snippet) return true;

    const isDisabledAttr = el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true";
    const hasDisabledClass =
      typeof el.className === "string" && /(?:^|[\s_-])disabled(?:$|[\s_-])/i.test(el.className);

    if (isDisabledAttr || hasDisabledClass) return true;

    // Semantic status or class tokens (code identifiers)
    const statusAttr = el.getAttribute("data-status") || el.getAttribute("data-state") || "";
    if (/^(upcoming|standby|waiting|pending)$/i.test(statusAttr)) return true;

    const container = elementResolver.findVoucherContainer(el);
    const containerCls = container && typeof container.className === "string" ? container.className : "";
    const elCls = typeof el.className === "string" ? el.className : "";

    return (
      /(?:^|[\s_-])(upcoming|standby|countdown|waiting|pending)(?:$|[\s_-])/i.test(elCls) ||
      /(?:^|[\s_-])(upcoming|standby|countdown|waiting|pending)(?:$|[\s_-])/i.test(containerCls)
    );
  }

  /**
   * Fast synchronous inspection of element characteristics.
   */
  inspect(el: HTMLElement): TargetDiagnosticsSummary {
    const framework = this.detectFramework(el);
    const { snippet } = this.findCountdownSnippet(el);
    const isStandby = this.isStandbyState(el);
    const hasCountdownTimer = Boolean(snippet);

    let strategy: ReloadStrategy = "reactive_no_reload";
    let confidence = 50;

    if (hasCountdownTimer) {
      strategy = "reactive_no_reload";
      confidence = 85;
    } else if (framework !== "unknown") {
      strategy = "reactive_no_reload";
      confidence = 70;
    } else {
      strategy = "static_dual_defense";
      confidence = 80;
    }

    return {
      framework,
      hasCountdownTimer,
      countdownSnippet: snippet,
      isTicking: false,
      isStandby,
      strategy,
      confidence,
    };
  }

  /**
   * Tests if the countdown snippet actively changes over a brief sample duration.
   */
  async sampleTicking(el: HTMLElement, sampleMs = 1200): Promise<boolean> {
    const initial = this.findCountdownSnippet(el);
    if (!initial.snippet || !initial.element) return false;

    const firstVal = initial.snippet;
    await new Promise((resolve) => setTimeout(resolve, sampleMs));

    if (!initial.element.isConnected) return false;
    const secondTxt = elementResolver.text(initial.element);
    const match = secondTxt.match(this.countdownRegex);
    return Boolean(match && match[1] !== firstVal);
  }

  /**
   * Comprehensive asynchronous diagnostics including timer ticking verification.
   */
  async analyze(el: HTMLElement, sampleTickingMs = 1200): Promise<TargetDiagnosticsSummary> {
    const summary = this.inspect(el);

    if (summary.hasCountdownTimer) {
      try {
        const isTicking = await this.sampleTicking(el, sampleTickingMs);
        summary.isTicking = isTicking;
        if (isTicking) {
          summary.confidence = 98;
          summary.strategy = "reactive_no_reload";
        }
      } catch {
        // ignore sample error
      }
    }

    return summary;
  }
}

export const targetDiagnostics = new TargetDiagnostics();
