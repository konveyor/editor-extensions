import * as path from "path";
import * as vscode from "vscode";
import { platform, arch } from "process";

/**
 * Get the path to the konveyor-analyzer-dep binary
 */
export function getDependencyProviderBinaryPath(context: vscode.ExtensionContext): string {
  const packageJson = context.extension.packageJSON;

  const baseAssetPath =
    packageJson.includedAssetPaths?.konveyorAnalyzerDep ||
    "../../downloaded_assets/konveyor-analyzer-dep";

  const platformArch = `${platform}-${arch}`;

  const binaryName = platform === "win32" ? "konveyor-analyzer-dep.exe" : "konveyor-analyzer-dep";

  const binaryPath = context.asAbsolutePath(path.join(baseAssetPath, platformArch, binaryName));

  return binaryPath;
}
