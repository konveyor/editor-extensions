import esbuild from "esbuild";

esbuild
  .build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    platform: "node",
    sourcemap: true,
    outdir: "dist",
    format: "esm",
    target: "esnext",
    splitting: true,
    outExtension: { ".js": ".esm.js" },
  })
  .catch(() => process.exit(1));

esbuild
  .build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    platform: "node",
    sourcemap: true,
    outdir: "dist",
    format: "cjs",
    target: "es2015",
    outExtension: { ".js": ".cjs.js" },
  })
  .catch(() => process.exit(1));
