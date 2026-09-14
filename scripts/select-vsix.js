import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Select a platform variant, falling back to universal-only releases for older branches. */
export function selectVsixAsset(assets, extensionName, target) {
  const escapedName = extensionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escapedName}-\\d+\\.\\d+\\.\\d+[^@]*?(?:@([^@]+))?\\.vsix$`);
  const matching = assets.filter((asset) => pattern.test(asset.name));
  const targeted = matching.filter((asset) => pattern.exec(asset.name)[1]);
  const candidates = targeted.length
    ? targeted.filter((asset) => pattern.exec(asset.name)[1] === target)
    : matching;
  const [asset] = candidates.sort(
    (a, b) => new Date(b.created_at ?? 0) - new Date(a.created_at ?? 0),
  );
  if (!asset) {
    throw new Error(`No VSIX found for ${extensionName} on ${target}`);
  }
  return asset;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [name, target = `${process.platform}-${process.arch}`, directory = "dist"] =
    process.argv.slice(2);
  const asset = selectVsixAsset(
    fs.readdirSync(directory).map((name) => ({ name })),
    name,
    target,
  );
  console.log(path.join(directory, asset.name).replaceAll(path.sep, "/"));
}
