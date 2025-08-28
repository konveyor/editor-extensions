import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import checker from "vite-plugin-checker";
import fs from "fs";
import path from "path";

export default defineConfig(() => {
  // Read package.json to get extension info
  const packagePath = path.resolve(__dirname, "../vscode/package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf-8"));

  // Use package.json values directly
  const extensionName = packageJson.name;

  return {
    plugins: [react(), checker({ typescript: true })],
    define: {
      __EXTENSION_NAME__: JSON.stringify(extensionName),
    },
    build: {
      outDir: "build",
      sourcemap: true,
      chunkSizeWarningLimit: 1024,
      // Configure assets directory to include branding assets
      assetsDir: "assets",
      rollupOptions: {
        output: {
          entryFileNames: `assets/[name].js`,
          chunkFileNames: `assets/[name].js`,
          assetFileNames: `assets/[name].[ext]`,
        },
      },
    },
    // Configure public directory to include our standardized assets
    publicDir: "../assets",
    base: "/out/webview", // this should match where the build files land after `npm run dist`
    server: {
      cors: true,
    },
  };
});
