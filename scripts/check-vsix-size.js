import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Open } from "unzipper";

// https://open-vsx.org/api/version reports maxExtensionSize in bytes (250 MiB).
const MAX_VSIX_BYTES = 250 * 1024 * 1024;

export async function checkVsixSizes(directory, { maxBytes = MAX_VSIX_BYTES } = {}) {
  const files = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".vsix"))
    .sort();
  if (files.length === 0) {
    throw new Error(`No VSIX files found in ${directory}`);
  }
  const rows = [];
  const failures = [];
  for (const name of files) {
    const file = path.join(directory, name);
    const size = fs.statSync(file).size;
    const status = size > maxBytes ? "OVER LIMIT" : "OK";
    console.log(
      `${name}: ${size} bytes (${(size / 1024 / 1024).toFixed(2)} MiB), limit ${maxBytes} bytes — ${status}`,
    );
    rows.push(`| ${name} | ${size} | ${status} |`);
    if (size > maxBytes) {
      failures.push(`${name} (${size} bytes) exceeds ${maxBytes} bytes`);
      const zip = await Open.file(file);
      const largest = zip.files.sort((a, b) => b.compressedSize - a.compressedSize).slice(0, 10);
      console.error("Largest compressed entries:");
      for (const entry of largest) {
        console.error(`  ${entry.compressedSize} bytes: ${entry.path}`);
      }
    }
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n### VSIX sizes (limit: ${maxBytes} bytes)\n\n| Artifact | Compressed bytes | Status |\n| --- | ---: | --- |\n${rows.join("\n")}\n`,
    );
  }
  if (failures.length) {
    throw new Error(`VSIX size check failed:\n${failures.join("\n")}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await checkVsixSizes(process.argv[2] ?? "dist");
}
