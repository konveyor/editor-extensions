import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  define: {
    __EXTENSION_NAME__: JSON.stringify("konveyor"),
  },
  test: {
    globals: true,
    environment: "jsdom",
    css: true,
    include: ["src/**/__tests__/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@editor-extensions/shared": path.resolve(__dirname, "../shared/dist/index.mjs"),
    },
  },
});
