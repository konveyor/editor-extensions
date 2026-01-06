import { EXTENSION_NAME } from "./constants";

export function getConfigHttpProtocol(): "http1" | "http2" {
  if (process.env.NODE_ENV === "test") {
    return "http1";
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const vscode = require("vscode");
  const config = vscode.workspace.getConfiguration(EXTENSION_NAME);
  const value = config.get("genai.httpProtocol", "http1");

  // Runtime validation to ensure the value matches the type signature
  // This protects against manual edits to settings.json
  return value === "http2" ? "http2" : "http1";
}
