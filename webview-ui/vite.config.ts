import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import checker from "vite-plugin-checker";
import fs from "fs";
import path from "path";

export default defineConfig(() => {
  // Read the root package.json to get publisher info
  const rootPackageJsonPath = path.resolve(__dirname, "../package.json");
  let publisher = "konveyor"; // default fallback

  try {
    const rootPackageJson = JSON.parse(fs.readFileSync(rootPackageJsonPath, "utf-8"));
    publisher = rootPackageJson.publisher?.toLowerCase() || "konveyor";
  } catch {
    console.warn("Could not read root package.json, using default publisher:", publisher);
  }

  return {
    plugins: [react(), checker({ typescript: true })],
    define: {
      __PUBLISHER__: JSON.stringify(publisher),
      __BRAND_NAME__: JSON.stringify(publisher === "konveyor" ? "Konveyor" : "MTA"),
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
