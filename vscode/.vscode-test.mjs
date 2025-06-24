import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "out/**/*.test.js",
  launchArgs: ["--enable-proposed-api=konveyor.konveyor-ai"],
});
