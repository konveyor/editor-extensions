// Jest transformer that turns a `.hbs` template file into a module exporting its
// raw text — mirroring esbuild's `text` loader so the registry resolves identical
// template sources under both build and test. Emitted as CommonJS so it loads
// without requiring jest's experimental ESM VM (matching the rest of the setup).
module.exports = {
  process(sourceText) {
    return { code: `module.exports = ${JSON.stringify(sourceText)};` };
  },
};
