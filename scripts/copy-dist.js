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
       *   - Adjust included asset paths based on copy targets
       */
      transform: (contents) => {
        const packageJson = JSON.parse(contents.toString());
        packageJson.dependencies = undefined;
        packageJson.devDependencies = undefined;
        packageJson["lint-staged"] = undefined;
        packageJson.contributes.javaExtensions = ["./assets/jdtls-bundles/bundle.jar"];

        packageJson.includedAssetPaths = {
          kai: "./assets/kai",
          jdtls: "./assets/jdtls",
          jdtlsBundles: "./assets/jdtls-bundles",
          fernFlowerPath: "./assets/fernflower/fernflower.jar",
          openSourceLabelsFile: "./assets/opensource-labels-file/maven.default.index",
          rulesets: "./assets/rulesets",
        };

        // Override realm configuration based on environment variable
        const targetRealm = process.env.KONVEYOR_REALM;
        if (targetRealm) {
          const configProps = packageJson.contributes?.configuration?.properties;
          // First check for the new correct key
          if (configProps?.["konveyor.solutionServer.auth.realm"]) {
            configProps["konveyor.solutionServer.auth.realm"].default = targetRealm;
          }
          // Fall back to legacy key if new one doesn't exist
          else if (configProps?.["konveyor.solutionServer.realm"]) {
            configProps["konveyor.solutionServer.realm"].default = targetRealm;
          }
        }

        return JSON.stringify(packageJson, null, 2);
      },
    },

    // files from vscode's build, excluding tests and test data
    {
      context: "vscode",
      src: [
        ".vscodeignore",
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

    // seed assets - rulesets
    {
      context: "downloaded_assets/rulesets",
      src: ["**/*"],
      dest: "dist/assets/rulesets",
    },

    // seed assets - jdtls bundles
    {
      context: "downloaded_assets/jdtls-bundles",
      src: ["**/*.jar"],
      dest: "dist/assets/jdtls-bundles",
    },

    // seed assets - opensource-labels-file
    {
      context: "downloaded_assets/opensource-labels-file",
      src: ["*"],
      dest: "dist/assets/opensource-labels-file",
    },

    // seed assets - kai binaries
    {
      context: "downloaded_assets/kai",
      src: ["*/kai*", "!**/*.zip"],
      dest: "dist/assets/kai",
    },

    // include the collect-assets metadata
    {
      context: "downloaded_assets",
      src: "collect-assets-meta.json",
      dest: "dist/assets",
    },
  ],
});
