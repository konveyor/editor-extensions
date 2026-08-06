import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineConfig } from "@vscode/test-cli";

// VS Code opens a unix socket inside its user data directory. macOS caps socket
// paths at 104 bytes, and the default (.vscode-test/user-data under the repo)
// blows past that on a deep checkout. Hand it a short path instead.
const userDataDir = mkdtempSync(join(tmpdir(), "vscode-test-"));

export default defineConfig({
  files: "out/test/**/*.test.js",
  launchArgs: ["--user-data-dir", userDataDir],
});
