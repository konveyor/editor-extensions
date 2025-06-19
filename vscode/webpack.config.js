/** @typedef {import('webpack').Configuration} WebpackConfig **/

/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("path");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const { globbySync } = require("globby");

module.exports = (env, argv) => {
  const mode = argv.mode || "none";
  const isDev = mode === "development";

  const testFiles = isDev ? globbySync("./test/**/*.test.ts", { cwd: __dirname }) : [];

  /** @type WebpackConfig */
  const extensionConfig = {
    target: "node",
    mode: mode,

    entry: {
      extension: "./src/extension.ts",
      ...(isDev ? { "integration.test": testFiles } : {}),
    },
    output: {
      path: path.resolve(__dirname, "out"),
      filename: "[name].js",
      libraryTarget: "commonjs2",
      // devtoolModuleFilenameTemplate: "../[resource-path]",
    },
    externals: {
      vscode: "commonjs vscode",
    },
    resolve: {
      extensions: [".ts", ".js"],
      // preferRelative: true,
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: [
            {
              loader: "ts-loader",
              // options: {
              //   compilerOptions: {
              //     sourceMap: "true",
              //     transpileOnly: false,
              //   },
              // },
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
      !isDev &&
        new CopyWebpackPlugin({
          patterns: [
            {
              from: path.resolve(__dirname, "../webview-ui/build"),
              to: path.resolve(__dirname, "out/webview"),
            },
          ],
        }),
    ].filter(Boolean),
  };

  return [extensionConfig];
};
