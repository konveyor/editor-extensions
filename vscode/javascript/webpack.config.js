/** @typedef {import('webpack').Configuration} WebpackConfig **/

/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("path");
const webpack = require("webpack");
const { execSync } = require("child_process");
const packageJson = require("./package.json");

// Get git commit SHA at build time
function getGitSha() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch (error) {
    console.warn("Could not get git SHA:", error.message);
    return "unknown";
  }
}

// Get short git SHA (first 7 characters)
function getGitShaShort() {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch (error) {
    console.warn("Could not get short git SHA:", error.message);
    return "unknown";
  }
}

module.exports = (env, argv) => {
  const mode = argv.mode || "none";

  /** @type WebpackConfig */
  const extensionConfig = {
    target: "node",
    mode: mode,

    entry: {
      extension: "./src/extension.ts",
    },
    output: {
      path: path.resolve(__dirname, "out"),
      filename: "[name].js",
      libraryTarget: "commonjs2",
    },
    externals: {
      vscode: "commonjs vscode",
    },
    resolve: {
      extensions: [".ts", ".js"],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: [
            {
              loader: "ts-loader",
            },
          ],
        },
      ],
    },
    devtool: "source-map",
    infrastructureLogging: {
      level: "log",
    },

    plugins: [
      new webpack.DefinePlugin({
        __EXTENSION_NAME__: JSON.stringify(packageJson.name),
        __EXTENSION_AUTHOR__: JSON.stringify(packageJson.author),
        __EXTENSION_PUBLISHER__: JSON.stringify(packageJson.publisher),
        __EXTENSION_VERSION__: JSON.stringify(packageJson.version),
        __EXTENSION_DISPLAY_NAME__: JSON.stringify(packageJson.displayName),
        __BUILD_GIT_SHA__: JSON.stringify(getGitSha()),
        __BUILD_GIT_SHA_SHORT__: JSON.stringify(getGitShaShort()),
        __BUILD_TIMESTAMP__: JSON.stringify(new Date().toISOString()),
      }),
    ].filter(Boolean),
  };

  return [extensionConfig];
};
