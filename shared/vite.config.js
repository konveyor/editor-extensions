import { resolve } from "path";
import { defineConfig } from "vite";
import nodeResolve from "@rollup/plugin-node-resolve";
import checker from "vite-plugin-checker";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [checker({ typescript: true }), dts()],
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
