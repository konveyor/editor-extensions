// Mock modules to make tests work without VSCode environment
import { Module } from "node:module";

const originalRequire = (Module.prototype as any).require;
(Module.prototype as any).require = function (id: string, ...args: any[]) {
  // Mock paths module to avoid loading globby
  // Normalize to handle both Windows backslashes and Unix forward slashes
  const normalizedId = id.replace(/\\/g, "/");
  if (
    normalizedId === "../paths" ||
    normalizedId === "../../paths" ||
    normalizedId === "../../../paths" ||
    normalizedId.endsWith("/paths.ts") ||
    normalizedId.endsWith("/paths")
  ) {
    return {
      isUriIgnored: (_uri: any) => false,
      // Add other exports from paths.ts if needed by other tests
    };
  }

  // Mock vscode module
  if (id === "vscode") {
    return {
      window: {
        showErrorMessage: (_message: string) => Promise.resolve(undefined),
        showInformationMessage: (_message: string) => Promise.resolve(undefined),
        showWarningMessage: (_message: string) => Promise.resolve(undefined),
      },
      Uri: {
        file: (path: string) => ({ fsPath: path, scheme: "file", path }),
      },
      ProgressLocation: {
        Notification: 15,
      },
      // Minimal configuration surface. Every getter returns the caller's
      // default, so code under test sees stock settings rather than throwing
      // on a missing `workspace`.
      workspace: {
        getConfiguration: (_section?: string) => ({
          get: (_key: string, defaultValue?: any) => defaultValue,
          has: (_key: string) => false,
          inspect: (_key: string) => undefined,
          update: (_key: string, _value: any) => Promise.resolve(),
        }),
      },
    };
  }

  return originalRequire.apply(this, [id, ...args]);
};
