#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log("🔄 Running MTA postbuild script...");

// Optional: Copy MTA-specific assets
const assetsDir = path.join(__dirname, "../assets/mta");
const resourcesDir = path.join(__dirname, "../vscode/resources");

if (fs.existsSync(assetsDir)) {
  // Copy MTA icon if it exists
  const mtaIcon = path.join(assetsDir, "mta-icon-color.png");
  const targetIcon = path.join(resourcesDir, "mta-icon-color.png");

  if (fs.existsSync(mtaIcon)) {
    fs.copyFileSync(mtaIcon, targetIcon);
    console.log("✅ Copied MTA icon assets");
  }
}

// Optional: Generate MTA-specific documentation
const docsDir = path.join(__dirname, "../docs/mta");
if (fs.existsSync(docsDir)) {
  console.log("✅ MTA documentation ready");
}

// Optional: Package validation
const packagePath = path.join(__dirname, "../vscode/package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));

if (packageJson.publisher === "mta" && packageJson.name === "mta") {
  console.log("✅ MTA package configuration validated");
} else {
  console.error("❌ Package configuration validation failed");
  process.exit(1);
}

console.log("✅ MTA postbuild complete");
