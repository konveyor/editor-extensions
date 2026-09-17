#! /usr/bin/env node
import fs from "fs";
import { cwdToProjectRoot } from "./_util.js";
import { packageExtension as packageDirectory } from "./_package.js";
import { checkVsixSizes } from "./check-vsix-size.js";

cwdToProjectRoot();

// Parse command line args
// Usage: node package-extensions.js [extension-type] [--pre-release]
const args = process.argv.slice(2);
const isPreRelease = args.includes("--pre-release");
const extensionType = args.find((arg) => !arg.startsWith("--"));

if (isPreRelease) {
  console.log("📦 Packaging as PRE-RELEASE\n");
}

if (extensionType) {
  // Package a specific extension
  await packageExtension(extensionType, isPreRelease);
} else {
  // Package all extensions
  await packageAllExtensions(isPreRelease);
}

await checkVsixSizes("dist");

async function packageExtension(type, preRelease = false) {
  const packageJsonPath = `vscode/${type}/package.json`;

  if (!fs.existsSync(packageJsonPath)) {
    console.error(`Error: Extension package.json not found at ${packageJsonPath}`);
    console.error(`Valid extension types: core, java, javascript, go, csharp, konveyor`);
    process.exit(1);
  }

  // Read extension name from package.json
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const extensionName = packageJson.name;
  const extensionDir = `dist/${extensionName}`;

  if (!fs.existsSync(extensionDir)) {
    console.error(`Error: Extension directory not found: ${extensionDir}`);
    console.error("Please run 'npm run dist' first.");
    process.exit(1);
  }

  console.log(`Packaging ${extensionName}${preRelease ? " (pre-release)" : ""}...`);

  try {
    await packageDirectory(extensionDir, "dist", preRelease);
    console.log(`✓ ${extensionName} packaged successfully`);
  } catch (error) {
    console.error(`✗ Failed to package ${extensionName}`);
    throw error;
  }
}

async function packageAllExtensions(preRelease = false) {
  console.log("Packaging all extensions...\n");

  // Find all directories in dist/ that contain a package.json
  const distDir = "dist";
  if (!fs.existsSync(distDir)) {
    console.error(`Error: ${distDir} directory not found.`);
    console.error("Please run 'npm run dist' first to build the dist folder.");
    process.exit(1);
  }

  const distEntries = fs.readdirSync(distDir, { withFileTypes: true });
  const extensionDirs = distEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => {
      const packageJsonPath = `${distDir}/${name}/package.json`;
      return fs.existsSync(packageJsonPath);
    });

  if (extensionDirs.length === 0) {
    console.error("Error: No extension directories found in dist/");
    console.error("Please run 'npm run dist' first to build the dist folder.");
    process.exit(1);
  }

  console.log(`Found ${extensionDirs.length} extension(s) to package:`);
  extensionDirs.forEach((dir) => console.log(`  - ${dir}`));
  console.log();

  // Package each extension
  for (const extensionName of extensionDirs) {
    const extensionDir = `${distDir}/${extensionName}`;

    console.log(`Packaging ${extensionName}${preRelease ? " (pre-release)" : ""}...`);

    try {
      await packageDirectory(extensionDir, distDir, preRelease);
      console.log(`✓ ${extensionName} packaged successfully\n`);
    } catch (error) {
      console.error(`✗ Failed to package ${extensionName}`);
      throw error;
    }
  }

  // List generated VSIX files
  console.log("Generated VSIX files:");
  const vsixFiles = fs.readdirSync(distDir).filter((f) => f.endsWith(".vsix"));
  if (vsixFiles.length === 0) {
    console.error("Warning: No VSIX files found in dist/");
  } else {
    vsixFiles.forEach((f) => console.log(`  ✓ dist/${f}`));
  }
}
