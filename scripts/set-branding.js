#!/usr/bin/env node

/**
 * Script to set branding for the editor extensions project
 * Usage: node scripts/set-branding.js [konveyor|mta]
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BRANDS = {
  konveyor: {
    publisher: "konveyor",
    displayName: "Konveyor",
    description:
      "VSCode Extension for Konveyor to assist in migrating and modernizing applications.",
    author: "Konveyor",
    icon: "vscode/resources/konveyor-icon.svg",
    vscodeName: "konveyor-ai",
    vscodeDisplayName: "Konveyor AI (kai) Extension for VSCode",
    vscodeDescription: "Generative AI assisted migration and modernization tool",
    vscodeIcon: "resources/konveyor-icon.svg",
  },
  mta: {
    publisher: "mta",
    displayName: "MTA",
    description:
      "VSCode Extension for MTA (Migration Toolkit for Applications) to assist in migrating and modernizing applications.",
    author: "MTA",
    icon: "vscode/resources/mta-icon.svg",
    vscodeName: "mta-ai",
    vscodeDisplayName: "MTA AI Extension for VSCode",
    vscodeDescription: "Generative AI assisted migration and modernization tool for MTA",
    vscodeIcon: "resources/mta-icon.svg",
  },
};

function updatePackageJson(filePath, updates) {
  try {
    const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
    Object.assign(content, updates);
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2) + "\n");
    console.log(`✅ Updated ${filePath}`);
  } catch (error) {
    console.error(`❌ Failed to update ${filePath}:`, error.message);
  }
}

function copyIcon(source, destination) {
  try {
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, destination);
      console.log(`✅ Copied ${source} to ${destination}`);
    } else {
      console.warn(`⚠️  Source icon not found: ${source}`);
    }
  } catch (error) {
    console.error(`❌ Failed to copy icon:`, error.message);
  }
}

function main() {
  const brand = process.argv[2]?.toLowerCase();

  if (!brand || !BRANDS[brand]) {
    console.log("Usage: node scripts/set-branding.js [konveyor|mta]");
    console.log("Available brands:", Object.keys(BRANDS).join(", "));
    process.exit(1);
  }

  const brandConfig = BRANDS[brand];
  console.log(`🎨 Setting branding to: ${brandConfig.displayName}`);

  // Update root package.json
  const rootPackagePath = path.join(__dirname, "..", "package.json");
  updatePackageJson(rootPackagePath, {
    publisher: brandConfig.publisher,
    displayName: brandConfig.displayName,
    description: brandConfig.description,
    author: brandConfig.author,
    icon: brandConfig.icon,
  });

  // Update VSCode extension package.json
  const vscodePackagePath = path.join(__dirname, "..", "vscode", "package.json");
  updatePackageJson(vscodePackagePath, {
    name: brandConfig.vscodeName,
    displayName: brandConfig.vscodeDisplayName,
    description: brandConfig.vscodeDescription,
    author: brandConfig.author,
    publisher: brandConfig.publisher,
    icon: brandConfig.vscodeIcon,
  });

  // Copy appropriate icon to generic icon.svg
  const sourceIcon = path.join(__dirname, "..", brandConfig.vscodeIcon);
  const destIcon = path.join(__dirname, "..", "vscode", "resources", "icon.svg");
  copyIcon(sourceIcon, destIcon);

  console.log(`\n🎉 Branding set to ${brandConfig.displayName}!`);
  console.log("Next steps:");
  console.log('1. Run "npm run build" to rebuild with new branding');
  console.log("2. The extension will now use the appropriate avatar and branding");
}

main();
