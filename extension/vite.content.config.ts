import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Config specifically for content script to output a self-contained IIFE bundle
export default defineConfig({
  plugins: [react()],
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
