import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // Tests run as a development build (local servers, simulator); production behaviour is tested
  // by mocking src/lib/build_env.ts.
  define: {
    __DH_DEV__: "true",
  },
  test: {
    environment: "happy-dom",
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
