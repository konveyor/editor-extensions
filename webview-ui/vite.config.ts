import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import checker from "vite-plugin-checker";
import fs from "fs";
import path from "path";

export default defineConfig(() => {
  // Read the VSCode extension package.json to get extension info
  const extensionPackageJsonPath = path.resolve(__dirname, "../vscode/package.json");
  let extensionName = "konveyor"; // default fallback
  let publisher = "konveyor"; // default fallback

  try {
    const extensionPackageJson = JSON.parse(fs.readFileSync(extensionPackageJsonPath, "utf-8"));
    extensionName = extensionPackageJson.name || "konveyor";
    publisher = extensionPackageJson.publisher?.toLowerCase() || "konveyor";
  } catch {
    console.warn("Could not read VSCode extension package.json, using defaults:", {
      extensionName,
      publisher,
    });
  }

  // Determine brand based on extension name
  const brandName =
    extensionName === "mta"
      ? "MTA"
      : extensionName === "konveyor"
        ? "Konveyor"
        : extensionName.charAt(0).toUpperCase() + extensionName.slice(1);

  return {
    plugins: [react(), checker({ typescript: true })],
    define: {
      __EXTENSION_NAME__: JSON.stringify(extensionName),
    },
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
      },
    },
    base: "/out/webview", // this should match where the build files land after `npm run dist`
    server: {
      cors: true,
    },
  };
});
