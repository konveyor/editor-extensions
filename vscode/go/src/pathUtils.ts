import * as path from "path";
import * as vscode from "vscode";
import { platform, arch } from "process";

/**
 * Get the path to the golang-dependency-provider binary
 */
export function getDependencyProviderBinaryPath(context: vscode.ExtensionContext): string {
  const packageJson = context.extension.packageJSON;

  const baseAssetPath =
    packageJson.includedAssetPaths?.golangDependencyProvider ||
    "../../downloaded_assets/golang-dependency-provider";

  const platformArch = `${platform}-${arch}`;

  const binaryName =
    platform === "win32" ? "golang-dependency-provider.exe" : "golang-dependency-provider";

  const binaryPath = context.asAbsolutePath(path.join(baseAssetPath, platformArch, binaryName));

  return binaryPath;
}
