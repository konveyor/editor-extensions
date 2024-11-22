#! /usr/bin/env node
import { cwdToProjectRoot } from "./_util.js";
import copy from "./_copy.js";

cwdToProjectRoot();

// Copy files to `dist/`
await copy({
  verbose: true,
  targets: [
    {
      src: "vscode/package.json",
      dest: "dist/",

      /**
       * package.json needs some changes when packaging in `dist/`
       *   - Remove dependencies since they are already bundled by vscode's bundler
       *   - Remove sections that are not relevant
       */
      transform: (contents) => {
        const packageJson = JSON.parse(contents.toString());
        packageJson.dependencies = undefined;
        packageJson.devDependencies = undefined;
        packageJson["lint-staged"] = undefined;
        return JSON.stringify(packageJson, null, 2);
      },
    },

    // files from vscode's build, excluding tests and test data
    {
      context: "vscode",
      src: [
        "LICENSE.md",
        "README.md",
        "CHANGELOG.md",
        "media/**/*",
        "out/**/*",
        "!out/webview",
        "!out/test",
        "!out/**/*.test{.js,.ts,.d.ts}",
        "resources/**/*",
      ],
      dest: "dist/",
    },

    // files from webview-ui's build
    {
      src: "webview-ui/build/",
      dest: "dist/out/webview/",
    },

    // seed assets (binaries and analyzer rulesets)
    {
      context: "vscode/",
      src: "assets/rulesets/**/*",
      dest: "dist/",
    },
    {
      context: "vscode/",
      src: "assets/bin/**/*",
      dest: "dist/",
    },
    // TODO: replace the repo analyzer binaries with the kai binaries
  ],
});
