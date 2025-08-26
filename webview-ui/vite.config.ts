import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import checker from "vite-plugin-checker";
import fs from "fs";
import path from "path";

export default defineConfig(() => {
  // Determine branding from environment or default to konveyor
  const brandingName = process.env.BRANDING || "konveyor";
  const brandingPath = path.resolve(__dirname, `../branding/${brandingName}`);

  // Read branding strings
  let brandingStrings = {
    productName: "Konveyor",
    productNameLowercase: "konveyor",
    extensionName: "konveyor",
  };

  try {
    const stringsPath = path.join(brandingPath, "strings.json");
    brandingStrings = JSON.parse(fs.readFileSync(stringsPath, "utf-8"));
  } catch (error) {
    console.warn(`Could not read branding strings from ${brandingPath}, using defaults:`, error);
  }

  return {
    plugins: [react(), checker({ typescript: true })],
    define: {
      __EXTENSION_NAME__: JSON.stringify(brandingStrings.extensionName),
      __BRANDING__: JSON.stringify(brandingStrings),
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
