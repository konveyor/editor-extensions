import { join } from "node:path";
import { platform, arch } from "node:process";
import { ExtensionContext } from "vscode";
import { globbySync } from "globby";

export interface BaseAssetPaths {
  /** Base directory for the kai binaries */
  kai: string;

  /** Base directory for the jdt.ls distribution to reference */
  jdtls: string;

  /** Base directory that contains any number of jdt.ls bundles to be found and referenced */
  jdtlsBundles: string;

  /** Path to the `fernflower.jar` (needed to support decompiling in analyzer) file */
  fernFlowerPath: string;

  /** Path to the `depOpenSourceLabelsFile` file */
  openSourceLabelsFile: string;

  /** Base directory for the rulesets yaml file tree */
  rulesets: string;
}

export interface AssetPaths extends BaseAssetPaths {
  /**
   * The platform/arch correct internal kai analyzer binary path.
   */
  kaiAnalyzer: string;

  /**
   * The platform/arch correct internal kai rpc server binary path.
   */
  kaiRpcServer: string;

  /**
   * The platform/arch correct jdt.ls binary path.
   */
  jdtlsBin: string;

  /**
   * The set of jar files globbed from the jdt.ls bundle root.
   */
  jdtlsBundleJars: string[];
}

/**
 * Provide common access the paths needed to start, configure and run analysis and request
 * solutions.  This class is configuration aware and will return the manually configured paths
 * when available.
 *
 * ExtensionContext -> package.json "includedAssetPaths" -> InternalAssetPaths(fully qualified paths)
 */
export function buildAssetPaths(ctx: ExtensionContext): AssetPaths {
  const packageJson = ctx.extension.packageJSON;
  const assetPaths: BaseAssetPaths = {
    kai: "./kai",
    jdtls: "./jdtls",
    jdtlsBundles: "./jdtls-bundles",
    fernFlowerPath: "./fernflower/fernflower.jar",
    openSourceLabelsFile: "./opensource-labels-file/maven.default.index",
    rulesets: "./rulesets",
    ...packageJson.includedAssetPaths,
  };

  for (const key of Object.keys(assetPaths) as Array<keyof BaseAssetPaths>) {
    assetPaths[key] = ctx.asAbsolutePath(assetPaths[key]);
  }

  const kaiAnalyzer = join(
    assetPaths.kai,
    `${platform}-${arch}`,
    `kai-analyzer-rpc${platform === "win32" ? ".exe" : ""}`,
  );

  const kaiRpcServer = join(
    assetPaths.kai,
    `${platform}-${arch}`,
    `kai-rpc-server${platform === "win32" ? ".exe" : ""}`,
  );

  // TODO(sdickers): bin/jdtls users python, so this may need to use a platform specific name
  const jdtlsBin = join(assetPaths.jdtls, "bin", "jdtls");

  const jdtlsBundleJars = globbySync("**/*.jar", {
    cwd: assetPaths.jdtlsBundles,
    onlyFiles: true,
  }).map((jar) => join(assetPaths.jdtlsBundles, jar));

  return {
    ...assetPaths,
    kaiAnalyzer,
    kaiRpcServer,
    jdtlsBin,
    jdtlsBundleJars,
  };
}
