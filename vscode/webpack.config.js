/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("path");
const CopyWebpackPlugin = require("copy-webpack-plugin");

module.exports = (env, argv) => {
  const mode = argv.mode || "none";
  const isDev = mode === "development";

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
      devtoolModuleFilenameTemplate: "../[resource-path]",
    },
    externals: {
      vscode: "commonjs vscode",
    },
    resolve: {
      extensions: [".ts", ".js"],
      preferRelative: true,
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: [
            {
              loader: "ts-loader",
              options: {
                compilerOptions: {
                  sourceMap: "true",
                  transpileOnly: false,
                },
              },
            },
          ],
        },
      ],
    },
    devtool: isDev ? "source-map" : "nosources-source-map",
    optimization: {
      splitChunks: false,
    },
    plugins: [
      !isDev &&
        new CopyWebpackPlugin({
          patterns: [
            {
              from: path.resolve(__dirname, "../webview-ui/build"),
              to: path.resolve(__dirname, "out/webview"),
            },
            {
              from: "src/test/testData",
              to: "test/testData",
            },
          ],
        }),
    ].filter(Boolean),
    infrastructureLogging: {
      level: "log",
    },
  };

  return [extensionConfig];
};
