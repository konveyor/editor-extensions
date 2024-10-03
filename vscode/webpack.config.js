const path = require("path");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const WebpackShellPluginNext = require("webpack-shell-plugin-next");
const CopyWebpackPlugin = require("copy-webpack-plugin");

module.exports = (env, argv) => {
  const mode = argv.mode || "none";
  const isDev = mode === "development";

  const extensionConfig = {
    target: "node",
    mode: mode,
    entry: "./src/extension.ts",
    output: {
      path: path.resolve(__dirname, "out"),
      filename: "extension.js",
      libraryTarget: "commonjs2",
      devtoolModuleFilenameTemplate: "../[resource-path]",
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
              options: {
                compilerOptions: {
                  sourceMap: "true",
                },
              },
            },
          ],
        },
      ],
    },
    devtool: isDev ? "source-map" : "nosources-source-map",
    infrastructureLogging: {
      level: "log",
    },
  };

  const webviewConfig = {
    target: "web",
    mode: mode,
    entry: "./src/webview/index.tsx",
    output: {
      filename: "[name].wv.js",
      path: path.resolve(__dirname, "out/webview"),
    },
    resolve: {
      extensions: [".js", ".ts", ".tsx"],
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: ["babel-loader", "ts-loader"],
        },
        {
          test: /\.css$/,
          use: [MiniCssExtractPlugin.loader, "css-loader"],
        },
      ],
    },
    plugins: [
      new MiniCssExtractPlugin({
        filename: "[name].css",
      }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: path.resolve(__dirname, "assets", "kantra"), // Source path
            to: path.resolve(__dirname, "out", "webview", "assets"), // Destination path
            noErrorOnMissing: true, // Optional: Avoid errors if the file is missing
            force: true, // Overwrite existing files
          },
        ],
      }),
      new WebpackShellPluginNext({
        onBuildEnd: {
          scripts: ["chmod +x out/webview/assets/kantra"],
          blocking: true, // Ensure the command finishes before proceeding
          parallel: false,
        },
      }),
    ],
    devtool: isDev ? "inline-cheap-module-source-map" : false,
    watch: isDev,
    watchOptions: {
      ignored: /node_modules/,
      poll: 1000,
    },
  };

  return [webviewConfig, extensionConfig];
};
