import { defineConfig } from "tsup";

// The MCP server is spawned as a standalone `node` process by the coding
// agent, both from a source checkout and from an installed VSIX. Inside the
// VSIX there is no node_modules, so every runtime dependency
// (@modelcontextprotocol/sdk, zod, ...) is inlined into a single
// self-contained file that `scripts/copy-dist.js` ships as a core asset.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  noExternal: [/.*/],
  bundle: true,
  minify: false,
  sourcemap: false,
  clean: true,
  outDir: "dist",
  banner: {
    js: "#!/usr/bin/env node",
  },
});
