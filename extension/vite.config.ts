import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import { productionManifest } from "./src/build/manifest_env";

/** Development build: `--mode development` (npm run dev / build:dev) or DH_ENV=development. */
export function isDevBuild(mode: string): boolean {
  return mode === "development" || process.env.DH_ENV === "development";
}

/** A production build ships a manifest without the localhost entries (src/build/manifest_env.ts). */
function manifestForEnv(isDev: boolean) {
  return {
    name: "dealhunter-manifest-env",
    closeBundle() {
      if (isDev) return;
      const file = path.resolve(__dirname, "dist/manifest.json");
      const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
      fs.writeFileSync(file, JSON.stringify(productionManifest(manifest), null, 2) + "\n");
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [react(), manifestForEnv(isDevBuild(mode))],
  define: {
    __DH_DEV__: JSON.stringify(isDevBuild(mode)),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, "popup.html"),
        background: path.resolve(__dirname, "src/background/index.ts"),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === "background") return "background.js";
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
  },
}));
