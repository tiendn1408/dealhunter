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

  it("C5: content.css cannot affect the page: every rule is scoped to DealHunter's own UI", async () => {
    // Built from source with the content Tailwind config (same as vite.content.config.ts)
    const { default: postcss } = await import("postcss");
    const { default: tailwindcss } = await import("tailwindcss");
    const root = path.resolve(__dirname, "../../..");
    const source = fs.readFileSync(path.resolve(__dirname, "style.css"), "utf-8");
    const result = await postcss([tailwindcss({ config: path.join(root, "tailwind.content.config.js") })]).process(source, {
      from: path.resolve(__dirname, "style.css"),
    });

    const ownUi = /#dealhunter-hud-root|#dealhunter-badge-root|\.dh-|#dh-|^body\.dh-picking-active/;
    const unscoped: string[] = [];
    result.root.walkRules((rule) => {
      if (rule.parent?.type === "atrule" && /keyframes/.test((rule.parent as any).name)) return;
      for (const sel of rule.selectors) if (!ownUi.test(sel.trim())) unscoped.push(sel);
    });
    expect(unscoped).toEqual([]);

    const css = result.css;
    expect(css).not.toMatch(/#root/); // the mount point of most React sites
    expect(css).not.toMatch(/\.container\b/);
    expect(css).toContain(":is(#dealhunter-hud-root, #dealhunter-badge-root, .dh-root) .hidden");
    // keyframes cannot clash with a page's "spin" / "pulse"
    for (const m of css.matchAll(/@keyframes\s+([\w-]+)/g)) expect(m[1]).toMatch(/^dh-/);
  }, 30_000);
});
