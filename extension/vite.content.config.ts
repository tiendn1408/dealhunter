import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Post-build plugin that converts all rem units in content.css to fixed pixels (1rem = 16px)
// This guarantees that host websites (Shopee, Caffiliate, Tiki, etc.) with custom root font sizes
// or rem scales CANNOT scale or distort DealHunter overlay dimensions!
function remToPxPlugin() {
  return {
    name: "vite-plugin-rem-to-px",
    enforce: "post" as const,
    generateBundle(_options: any, bundle: any) {
      for (const fileName in bundle) {
        const file = bundle[fileName];
        if (fileName.endsWith(".css") && file.type === "asset" && typeof file.source === "string") {
          file.source = file.source.replace(/(-?\d*\.?\d+)rem\b/g, (_match: string, val: string) => {
            const px = parseFloat(val) * 16;
            return `${Number(px.toFixed(2))}px`;
          });
        }
      }
    },
  };
}

// Config specifically for content script to output a self-contained IIFE bundle
export default defineConfig({
  plugins: [react(), remToPxPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, "src/content/index.tsx"),
      name: "DealHunterContent",
      formats: ["iife"],
      fileName: () => "content.js",
    },
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith(".css")) {
            return "content.css";
          }
          return "assets/[name].[ext]";
        },
      },
    },
  },
});
