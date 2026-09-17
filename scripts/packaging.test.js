import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Open } from "unzipper";
import { packageExtension } from "./_package.js";
import { checkVsixSizes } from "./check-vsix-size.js";
import { selectVsixAsset } from "./select-vsix.js";

const targets = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-arm64",
  "win32-x64",
];

function fixture(t, csharp = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vsix-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const extension = path.join(root, "extension");
  fs.mkdirSync(extension);
  fs.writeFileSync(
    path.join(extension, "package.json"),
    JSON.stringify({
      name: "acme-csharp",
      publisher: "acme",
      version: "1.2.3",
      engines: { vscode: "^1.93.0" },
      repository: "https://github.com/konveyor/editor-extensions",
      main: "extension.js",
      activationEvents: ["onLanguage:csharp"],
      ...(csharp && {
        includedAssetPaths: { csharpAnalyzerProvider: "./assets/c-sharp-analyzer-provider" },
      }),
    }),
  );
  fs.writeFileSync(path.join(extension, "extension.js"), "exports.activate = () => {};");
  fs.writeFileSync(path.join(extension, "LICENSE.txt"), "Test fixture");
  fs.writeFileSync(path.join(extension, "payload.bin"), randomBytes(4096));
  if (csharp) {
    for (const target of targets) {
      const dir = path.join(extension, "assets/c-sharp-analyzer-provider", target);
      fs.mkdirSync(path.join(dir, "BuildHost-netcore"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, target.startsWith("win32") ? "CSharpProvider.exe" : "CSharpProvider"),
        target,
        { mode: 0o755 },
      );
      fs.writeFileSync(path.join(dir, "BuildHost-netcore/runtime.dll"), `runtime-${target}`);
    }
  }
  return { root, extension };
}

test("packages all six targets with complete matching runtimes and unchanged identity", async (t) => {
  const { root, extension } = fixture(t);
  const staleUniversal = path.join(root, "acme-csharp-1.2.3.vsix");
  fs.writeFileSync(staleUniversal, "stale universal package");
  const files = await packageExtension(extension, root, true);
  assert.equal(files.length, 6);
  assert.equal(fs.existsSync(staleUniversal), false);
  for (const target of targets) {
    const file = path.join(root, `acme-csharp-1.2.3@${target}.vsix`);
    assert.ok(files.includes(file));
    const zip = await Open.file(file);
    const manifest = (
      await zip.files.find((f) => f.path === "extension.vsixmanifest").buffer()
    ).toString();
    assert.match(manifest, new RegExp(`TargetPlatform="${target}"`));
    assert.match(manifest, /Microsoft.VisualStudio.Code.PreRelease.*true/);
    const pkg = JSON.parse(
      await zip.files.find((f) => f.path === "extension/package.json").buffer(),
    );
    assert.equal(pkg.name, "acme-csharp");
    assert.equal(pkg.version, "1.2.3");
    assert.equal(pkg.publisher, "acme");
    const providers = zip.files.filter((f) =>
      f.path.startsWith("extension/assets/c-sharp-analyzer-provider/"),
    );
    assert.equal(providers.length, 2);
    assert.ok(providers.every((f) => f.path.includes(`/${target}/`)));
    assert.ok(providers.some((f) => f.path.endsWith("BuildHost-netcore/runtime.dll")));
  }
  assert.equal(fs.readdirSync(path.join(extension, "assets/c-sharp-analyzer-provider")).length, 6);
  await checkVsixSizes(root);
});

test("fails before packaging when a required platform entrypoint is missing", async (t) => {
  const { root, extension } = fixture(t);
  fs.rmSync(
    path.join(extension, "assets/c-sharp-analyzer-provider/win32-arm64/CSharpProvider.exe"),
  );
  await assert.rejects(packageExtension(extension, root), /win32-arm64/);
  assert.equal(fs.readdirSync(root).filter((name) => name.endsWith(".vsix")).length, 0);
});

test("universal extensions stay universal; size guard uses compressed bytes and reports failures", async (t) => {
  const { root, extension } = fixture(t, false);
  const [file] = await packageExtension(extension, root);
  assert.equal(path.basename(file), "acme-csharp-1.2.3.vsix");
  const zip = await Open.file(file);
  const manifest = (
    await zip.files.find((f) => f.path === "extension.vsixmanifest").buffer()
  ).toString();
  assert.doesNotMatch(manifest, /TargetPlatform|Microsoft.VisualStudio.Code.PreRelease/);
  const size = fs.statSync(file).size;
  await checkVsixSizes(root, { maxBytes: size });
  await assert.rejects(
    checkVsixSizes(root, { maxBytes: size - 1 }),
    /acme-csharp-1.2.3.vsix.*exceeds.*bytes/s,
  );
});

test("size guard rejects an empty artifact directory", async (t) => {
  const { root } = fixture(t, false);
  await assert.rejects(checkVsixSizes(root), /No VSIX/);
});

test("artifact selection chooses the host target, supports legacy universal packages, and rejects mismatches", () => {
  const universal = { name: "acme-csharp-1.0.0.vsix" };
  const windows = { name: "acme-csharp-1.2.3@win32-x64.vsix" };
  const linux = { name: "acme-csharp-1.2.3@linux-x64.vsix" };
  assert.equal(selectVsixAsset([windows, universal, linux], "acme-csharp", "linux-x64"), linux);
  assert.equal(selectVsixAsset([linux, windows], "acme-csharp", "win32-x64"), windows);
  assert.equal(selectVsixAsset([universal], "acme-csharp", "darwin-arm64"), universal);
  assert.throws(
    () => selectVsixAsset([windows, universal], "acme-csharp", "linux-x64"),
    /linux-x64/,
  );
  assert.throws(() => selectVsixAsset([linux], "acme", "linux-x64"), /No VSIX/);
});
