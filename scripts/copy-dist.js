#! /usr/bin/env node
import { cwdToProjectRoot } from "./_util.js";
import copy from "./_copy.js";
import fs from "fs";

cwdToProjectRoot();

// Read extension metadata from package.json files to get extension names
const corePackage = JSON.parse(fs.readFileSync("vscode/core/package.json", "utf8"));
const javaPackage = JSON.parse(fs.readFileSync("vscode/java/package.json", "utf8"));
const jsPackage = JSON.parse(fs.readFileSync("vscode/javascript/package.json", "utf8"));
const goPackage = JSON.parse(fs.readFileSync("vscode/go/package.json", "utf8"));

const CORE_EXTENSION_NAME = corePackage.name; // e.g., "konveyor" or "migration-toolkit-runtimes"
const JAVA_EXTENSION_NAME = javaPackage.name; // e.g., "konveyor-java" or "migration-toolkit-runtimes-java"
const JS_EXTENSION_NAME = jsPackage.name; // e.g., "konveyor-javascript" or "migration-toolkit-runtimes-javascript"
const GO_EXTENSION_NAME = goPackage.name; // e.g., "konveyor-go" or "migration-toolkit-runtimes-go"

console.log(`Building dist for ${CORE_EXTENSION_NAME} (core) extension...`);

// Copy files to `dist/{core-extension-name}/`
await copy({
  verbose: true,
  targets: [
    {
      src: "vscode/core/package.json",
      dest: `dist/${CORE_EXTENSION_NAME}/`,

      /**
       * package.json needs some changes when packaging in `dist/`
       *   - Remove dependencies since they are already bundled by vscode's bundler
       *   - Remove sections that are not relevant
       *   - Adjust included asset paths based on copy targets
       */
      transform: (contents) => {
        const packageJson = JSON.parse(contents.toString());
        const originalIncludedKai = packageJson.includedAssetPaths?.kai !== undefined;

        packageJson.dependencies = undefined;
        packageJson.devDependencies = undefined;
        packageJson["lint-staged"] = undefined;

        packageJson.includedAssetPaths = {
          ...(originalIncludedKai && { kai: "./assets/kai" }),
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
      context: "vscode/core",
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
      dest: `dist/${CORE_EXTENSION_NAME}/`,
    },

    // files from webview-ui's build
    {
      src: "webview-ui/build/",
      dest: `dist/${CORE_EXTENSION_NAME}/out/webview/`,
    },

    // seed assets - rulesets
    {
      context: "downloaded_assets/rulesets",
      src: ["**/*"],
      dest: `dist/${CORE_EXTENSION_NAME}/assets/rulesets`,
    },

    // seed assets - opensource-labels-file
    {
      context: "downloaded_assets/opensource-labels-file",
      src: ["*"],
      dest: `dist/${CORE_EXTENSION_NAME}/assets/opensource-labels-file`,
    },

    // seed assets - kai binaries (conditional based on original package.json)
    ...(corePackage.includedAssetPaths?.kai !== undefined
      ? [
          {
            context: "downloaded_assets/kai",
            src: ["*/kai*", "!**/*.zip"],
            dest: `dist/${CORE_EXTENSION_NAME}/assets/kai`,
          },
        ]
      : []),

    // include the collect-assets metadata
    {
      context: "downloaded_assets",
      src: "collect-assets-meta.json",
      dest: `dist/${CORE_EXTENSION_NAME}/assets`,
    },
  ],
});

console.log(`Building dist for ${JAVA_EXTENSION_NAME} extension...`);

// Copy files to `dist/{java-extension-name}/`
await copy({
  verbose: true,
  targets: [
    {
      src: "vscode/java/package.json",
      dest: `dist/${JAVA_EXTENSION_NAME}/`,
      transform: (contents) => {
        const packageJson = JSON.parse(contents.toString());

        packageJson.dependencies = undefined;
        packageJson.devDependencies = undefined;
        packageJson["lint-staged"] = undefined;

        // Fix icon path from ../resources/icon.png to resources/icon.png
        if (packageJson.icon && packageJson.icon.startsWith("../")) {
          packageJson.icon = packageJson.icon.replace("../", "");
        }

        packageJson.includedAssetPaths = {
          javaExternalProvider: "./assets/java-external-provider",
        };

        packageJson.contributes.javaExtensions = ["./assets/jdtls-bundles/bundle.jar"];

        return JSON.stringify(packageJson, null, 2);
      },
    },

    // files from vscode/java build
    {
      context: "vscode/java",
      src: [
        ".vscodeignore",
        "LICENSE.md",
        "README.md",
        "out/**/*",
        "!out/test",
        "!out/**/*.test{.js,.ts,.d.ts}",
        "resources/**/*",
      ],
      dest: `dist/${JAVA_EXTENSION_NAME}/`,
    },

    // seed assets - java-external-provider binaries
    {
      context: "downloaded_assets/java-external-provider",
      src: ["*/java-external-provider*"],
      dest: `dist/${JAVA_EXTENSION_NAME}/assets/java-external-provider`,
    },

    // seed assets - jdtls bundles (needed by java extension)
    {
      context: "downloaded_assets/jdtls-bundles",
      src: ["**/*.jar"],
      dest: `dist/${JAVA_EXTENSION_NAME}/assets/jdtls-bundles`,
    },
  ],
});

console.log(`Building dist for ${JS_EXTENSION_NAME} extension...`);

// Copy files to `dist/{js-extension-name}/`
await copy({
  verbose: true,
  targets: [
    {
      src: "vscode/javascript/package.json",
      dest: `dist/${JS_EXTENSION_NAME}/`,
      transform: (contents) => {
        const packageJson = JSON.parse(contents.toString());

        packageJson.dependencies = undefined;
        packageJson.devDependencies = undefined;
        packageJson["lint-staged"] = undefined;

        // Fix icon path from ../resources/icon.png to resources/icon.png
        if (packageJson.icon && packageJson.icon.startsWith("../")) {
          packageJson.icon = packageJson.icon.replace("../", "");
        }

        packageJson.includedAssetPaths = {
          genericExternalProvider: "./assets/generic-external-provider",
        };

        return JSON.stringify(packageJson, null, 2);
      },
    },

    // files from vscode/javascript build
    {
      context: "vscode/javascript",
      src: [
        ".vscodeignore",
        "LICENSE.md",
        "README.md",
        "out/**/*",
        "!out/test",
        "!out/**/*.test{.js,.ts,.d.ts}",
        "resources/**/*",
      ],
      dest: `dist/${JS_EXTENSION_NAME}/`,
    },

    // seed assets - generic-external-provider binaries
    {
      context: "downloaded_assets/generic-external-provider",
      src: ["*/generic-external-provider*"],
      dest: `dist/${JS_EXTENSION_NAME}/assets/generic-external-provider`,
    },
  ],
});

console.log(`Building dist for ${GO_EXTENSION_NAME} extension...`);

// Copy files to `dist/{go-extension-name}/`
await copy({
  verbose: true,
  targets: [
    {
      src: "vscode/go/package.json",
      dest: `dist/${GO_EXTENSION_NAME}/`,
      transform: (contents) => {
        const packageJson = JSON.parse(contents.toString());

        packageJson.dependencies = undefined;
        packageJson.devDependencies = undefined;
        packageJson["lint-staged"] = undefined;

        // Fix icon path from resources/icon.png to resources/icon.png (already correct)
        if (packageJson.icon && packageJson.icon.startsWith("../")) {
          packageJson.icon = packageJson.icon.replace("../", "");
        }

        packageJson.includedAssetPaths = {
          genericExternalProvider: "./assets/generic-external-provider",
          golangDependencyProvider: "./assets/golang-dependency-provider",
        };

        return JSON.stringify(packageJson, null, 2);
      },
    },

    // files from vscode/go build
    {
      context: "vscode/go",
      src: [
        ".vscodeignore",
        "LICENSE.md",
        "README.md",
        "out/**/*",
        "!out/test",
        "!out/**/*.test{.js,.ts,.d.ts}",
        "resources/**/*",
      ],
      dest: `dist/${GO_EXTENSION_NAME}/`,
    },

    // seed assets - generic-external-provider binaries
    {
      context: "downloaded_assets/generic-external-provider",
      src: ["*/generic-external-provider*"],
      dest: `dist/${GO_EXTENSION_NAME}/assets/generic-external-provider`,
    },

    // seed assets - golang-dependency-provider binaries
    {
      context: "downloaded_assets/golang-dependency-provider",
      src: ["*/golang-dependency-provider*"],
      dest: `dist/${GO_EXTENSION_NAME}/assets/golang-dependency-provider`,
    },
  ],
});

console.log("\nAll extensions built successfully!");
console.log(`  - dist/${CORE_EXTENSION_NAME}/`);
console.log(`  - dist/${JAVA_EXTENSION_NAME}/`);
console.log(`  - dist/${JS_EXTENSION_NAME}/`);
console.log(`  - dist/${GO_EXTENSION_NAME}/`);
