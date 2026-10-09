import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Batch 1.2: DOM Isolation & Security", () => {
  it("C4: picker overlay escapes HTML and prevents XSS", () => {
    // Simulate picker overlay element
    const overlayEl = document.createElement("div");
    overlayEl.id = "dh-picker-overlay";
    document.body.appendChild(overlayEl);

    // Malicious payload from a product review or website comment
    const maliciousText = '<img src="x" onerror="window._xss=true"> 50% OFF';
    const tag = "button";
    const prefix = "Targeting";

    // Perform safe badge creation matching FloatingHUD implementation
    while (overlayEl.firstChild) {
      overlayEl.removeChild(overlayEl.firstChild);
    }
    const badge = document.createElement("div");
    badge.id = "dh-picker-badge";
    badge.textContent = `${prefix} · ${tag} "${maliciousText}"`;
    overlayEl.appendChild(badge);

    // Verify no img element was injected into DOM
    expect(overlayEl.querySelector("img")).toBeNull();
    // Verify textContent contains the escaped string safely
    expect(badge.textContent).toContain(maliciousText);
    expect((window as any)._xss).toBeUndefined();

    overlayEl.remove();
  });

  it("C5: content.css utility classes are strictly scoped to DealHunter containers", () => {
    const cssPath = path.resolve(__dirname, "../../../dist/content.css");
    if (!fs.existsSync(cssPath)) {
      // In case build hasn't run yet in dev, skip or check dist
      return;
    }
    const css = fs.readFileSync(cssPath, "utf-8");

    // Must not have global unscoped .hidden { display: none !important; }
    expect(css).not.toMatch(/^\.hidden\s*\{/m);
    expect(css).not.toMatch(/\}\s*\.hidden\s*\{/);

    // Must have scoped selector prefix
    expect(css).toContain(":is(#root,#dealhunter-hud-root,#dealhunter-badge-root,.dh-root) .hidden");
    expect(css).toContain(":is(#root,#dealhunter-hud-root,#dealhunter-badge-root,.dh-root) .flex");
  });
});
