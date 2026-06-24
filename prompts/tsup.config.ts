import { defineConfig } from "tsup";

// The prompt templates are shipped as embedded text inside the bundle so that
// downstream consumers (agentic -> tsup, vscode/core -> webpack) get a fully
// self-contained module with no runtime filesystem access. esbuild's `text`
// loader inlines every `.hbs` import as a string literal at build time.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  outDir: "dist",
  esbuildOptions(options) {
    options.loader = {
      ...options.loader,
      ".hbs": "text",
    };
  },
});
