import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createVSIX } from "@vscode/vsce";

const CSHARP_TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-arm64",
  "win32-x64",
];

/** Package a staged extension, retaining only the matching C# runtime in each target. */
export async function packageExtension(extensionDir, outputDir, preRelease = false) {
  extensionDir = path.resolve(extensionDir);
  outputDir = path.resolve(outputDir);
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, "package.json"), "utf8"));
  const providerPath = manifest.includedAssetPaths?.csharpAnalyzerProvider;
  const targets = providerPath ? CSHARP_TARGETS : [undefined];
  const providerDir = providerPath && path.resolve(extensionDir, providerPath);

  // Check the entire matrix up front rather than silently dropping a supported platform.
  if (providerDir) {
    for (const target of targets) {
      const entrypoint = target.startsWith("win32") ? "CSharpProvider.exe" : "CSharpProvider";
      const binary = path.join(providerDir, target, entrypoint);
      if (!fs.existsSync(binary) || !fs.statSync(binary).isFile()) {
        throw new Error(`Missing C# analyzer for ${target}: ${binary}. Run collect-assets first.`);
      }
    }
  }

  const files = [];
  for (const target of targets) {
    const packagePath = path.join(
      outputDir,
      `${manifest.name}-${manifest.version}${target ? `@${target}` : ""}.vsix`,
    );
    const staging = target
      ? fs.mkdtempSync(path.join(os.tmpdir(), "konveyor-package-"))
      : undefined;
    try {
      if (staging) {
        fs.cpSync(extensionDir, staging, {
          recursive: true,
          filter: (source) => {
            const relative = path.relative(providerDir, source);
            // Keep shared files and the complete matching self-contained publish directory.
            return (
              relative === "" ||
              relative.startsWith(`..${path.sep}`) ||
              relative === ".." ||
              relative.split(path.sep)[0] === target
            );
          },
        });
      }
      await createVSIX({
        cwd: staging ?? extensionDir,
        packagePath,
        target,
        preRelease,
        dependencies: false,
      });
      files.push(packagePath);
    } finally {
      if (staging) {
        fs.rmSync(staging, { recursive: true, force: true });
      }
    }
  }
  if (providerDir) {
    // A repeat package run must not leave the old universal artifact in the publish glob.
    fs.rmSync(path.join(outputDir, `${manifest.name}-${manifest.version}.vsix`), { force: true });
  }
  return files;
}
