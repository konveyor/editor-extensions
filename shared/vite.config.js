import { resolve } from "path";
import { defineConfig } from "vite";
import nodeResolve from "@rollup/plugin-node-resolve";
import checker from "vite-plugin-checker";

export default defineConfig({
  plugins: [checker({ typescript: true })],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "Shared",
      fileName: (format) => (format === "es" ? "index.mjs" : "index.cjs"),
      formats: ["es", "cjs"],
    },
    minify: false,
    sourcemap: true,
    rollupOptions: {
      plugins: [nodeResolve()], // this is a library so don't package libraries
    },
  },
});
