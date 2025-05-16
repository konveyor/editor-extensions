import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import checker from "vite-plugin-checker";
import { resolve } from "path";

export default defineConfig({
  plugins: [react(), checker({ typescript: true })],
  build: {
    outDir: "build",
    sourcemap: true,
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/[name].js`,
        assetFileNames: `assets/[name].[ext]`,
      },
      input: {
        main: resolve(__dirname, "src/index.tsx"),
      },
    },
  },
  base: "/out/webview", // this should match where the build files land after `npm run dist`
  server: {
    cors: true,
    fs: {
      // Allow serving files from one level up to the project root
      allow: [".."],
    },
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  },
});
