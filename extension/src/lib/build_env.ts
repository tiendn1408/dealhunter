declare const __DH_DEV__: boolean | undefined;

/**
 * Development build (`npm run dev`, `npm run build:dev`): local DealHunter servers (web :3000/:3100,
 * API :8080) and the Caffiliate Bench simulator (:3100) are trusted. A production build
 * (`npm run build`) trusts only DealHunter's real origins. Set at build time by the Vite configs
 * (DH_ENV / --mode); tests run as development (vitest.config.ts).
 */
export const IS_DEV_BUILD: boolean = typeof __DH_DEV__ === "boolean" ? __DH_DEV__ : false;
