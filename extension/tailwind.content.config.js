import base from "./tailwind.config.js";

/**
 * Tailwind for the content script CSS (content.css), which is injected into every page the HUD or
 * the price badge appears on. Nothing in it may affect the page:
 * - utilities only apply inside DealHunter's own containers (never `#root`, the mount point of most
 *   React sites),
 * - only classes of the content UI are generated (the popup has its own CSS),
 * - no `.container` component, and keyframes renamed `dh-*` so they cannot clash with the page's.
 */
/** @type {import('tailwindcss').Config} */
export default {
  ...base,
  important: ":is(#dealhunter-hud-root, #dealhunter-badge-root, .dh-root)",
  content: ["./src/content/**/*.{ts,tsx}"],
  corePlugins: { container: false, preflight: false },
  theme: {
    ...base.theme,
    keyframes: {
      "dh-spin": { to: { transform: "rotate(360deg)" } },
      "dh-ping": { "75%, 100%": { transform: "scale(2)", opacity: "0" } },
      "dh-pulse": { "50%": { opacity: ".5" } },
      "dh-bounce": {
        "0%, 100%": { transform: "translateY(-25%)", animationTimingFunction: "cubic-bezier(0.8,0,1,1)" },
        "50%": { transform: "none", animationTimingFunction: "cubic-bezier(0,0,0.2,1)" },
      },
    },
    animation: {
      none: "none",
      spin: "dh-spin 1s linear infinite",
      ping: "dh-ping 1s cubic-bezier(0, 0, 0.2, 1) infinite",
      pulse: "dh-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      bounce: "dh-bounce 1s infinite",
    },
  },
};
