// HTTP protocol configuration getter
// Separate file to avoid vscode import in test environments

import { EXTENSION_NAME } from "./constants";

export function getConfigHttpProtocol(): "http1" | "http2" {
  if (process.env.NODE_ENV === "test") {
    return "http1";
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const vscode = require("vscode");
  const config = vscode.workspace.getConfiguration(EXTENSION_NAME);
  return config.get("genai.httpProtocol", "http1");
}
