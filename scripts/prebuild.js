#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read package.json to determine which brand we're building
const packagePath = path.join(__dirname, "../vscode/package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));

// Use the package name to determine branding
const extensionName = packageJson.name;
const displayName = extensionName.toUpperCase();

console.log(`🔄 Running prebuild for ${extensionName}...`);
console.log(`📦 Transforming package.json...`);

// Define the list of known brands
const knownBrands = ["konveyor", "mta"];

// Build regex patterns from the brand list
const brandPattern = knownBrands.join("|");
const brandRegex = new RegExp(brandPattern, "gi");
const brandPrefixRegex = new RegExp(`\\b(${brandPattern})\\.`, "gi");
const brandWordRegex = new RegExp(`\\b(${brandPattern})(?=\\s|$)`, "gi");

// Apply branding transformations
Object.assign(packageJson, {
  displayName: `${displayName} Extension for VSCode`,
  description:
    extensionName === "mta"
      ? "Migration Toolkit for Applications - Enterprise migration and modernization tool"
      : "Open-source migration and modernization tool",
  publisher: extensionName,
  author: extensionName === "mta" ? "Red Hat" : "Konveyor",
  icon: packageJson.icon, // Keep existing icon path - assets will be copied later
});

// Transform configuration properties
if (packageJson.contributes?.configuration?.properties) {
  const props = packageJson.contributes.configuration.properties;
  const newProps = {};

  Object.keys(props).forEach((key) => {
    const newKey = key.replace(/^[^.]+\./, `${extensionName}.`);
    newProps[newKey] = props[key];
  });

  packageJson.contributes.configuration.properties = newProps;
  packageJson.contributes.configuration.title = displayName;
}

// Transform commands
if (packageJson.contributes?.commands) {
  // Categories that should not be transformed by branding
  const preservedCategories = ["diffEditor"];

  packageJson.contributes.commands = packageJson.contributes.commands.map((cmd) => ({
    ...cmd,
    command: cmd.command.replace(/^[^.]+\./, `${extensionName}.`),
    // Only transform category if it's not in the preserved list
    category: preservedCategories.includes(cmd.category) ? cmd.category : displayName,
    title: cmd.title?.replace(brandRegex, displayName) || cmd.title,
  }));
}

// Transform views and containers
if (packageJson.contributes?.viewsContainers?.activitybar) {
  packageJson.contributes.viewsContainers.activitybar =
    packageJson.contributes.viewsContainers.activitybar.map((container) => ({
      ...container,
      id: extensionName,
      title: displayName,
      icon: container.icon, // Keep existing icon path - assets will be copied later
    }));
}

if (packageJson.contributes?.views) {
  const newViews = {};
  Object.keys(packageJson.contributes.views).forEach((viewKey) => {
    newViews[extensionName] = packageJson.contributes.views[viewKey].map((view) => ({
      ...view,
      id: view.id.replace(/^[^.]+\./, `${extensionName}.`),
      name: view.name.replace(brandRegex, displayName),
    }));
  });
  packageJson.contributes.views = newViews;
}

// Transform menus
if (packageJson.contributes?.menus) {
  const transformMenuCommands = (menuItems) => {
    return menuItems.map((item) => ({
      ...item,
      command: item.command?.replace(/^[^.]+\./, `${extensionName}.`),
      when: item.when
        ?.replace(brandPrefixRegex, `${extensionName}.`)
        .replace(brandWordRegex, extensionName),
      submenu: item.submenu?.replace(/^[^.]+\./, `${extensionName}.`),
    }));
  };

  const newMenus = {};
  Object.keys(packageJson.contributes.menus).forEach((menuKey) => {
    const newMenuKey = new RegExp(`^(${brandPattern})`, "i").test(menuKey)
      ? menuKey.replace(/^[^.]+/, extensionName)
      : menuKey;
    newMenus[newMenuKey] = transformMenuCommands(packageJson.contributes.menus[menuKey]);
  });
  packageJson.contributes.menus = newMenus;
}

// Transform submenus
if (packageJson.contributes?.submenus) {
  packageJson.contributes.submenus = packageJson.contributes.submenus.map((submenu) => ({
    ...submenu,
    id: submenu.id.replace(/^[^.]+/, extensionName),
    label: `${displayName} Actions`,
  }));
}

// Write the transformed package.json
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
console.log(`✅ ${displayName} branding transformations complete`);

// Copy assets - whatever exists in the directories gets used
console.log(`🖼️  Copying assets...`);

// 1. Copy VSCode sidebar icon (whatever icon exists in sidebar-icons/)
const iconSource = path.join(__dirname, "..", "assets/branding/sidebar-icons/icon.png");
const iconTarget = path.join(__dirname, "..", "vscode/resources/icon.png");

if (fs.existsSync(iconSource)) {
  fs.copyFileSync(iconSource, iconTarget);
  console.log(`  ✅ VSCode sidebar icon copied`);
} else {
  console.warn(`  ⚠️  No sidebar icon found at: assets/branding/sidebar-icons/icon.png`);
}

// 2. Copy webview avatar (whatever avatar exists in avatar-icons/)
const avatarSource = path.join(__dirname, "..", "assets/branding/avatar-icons/avatar.svg");
const avatarTarget = path.join(__dirname, "..", "webview-ui/public/avatarIcons/avatar.svg");

if (fs.existsSync(avatarSource)) {
  // Ensure target directory exists
  const avatarDir = path.dirname(avatarTarget);
  if (!fs.existsSync(avatarDir)) {
    fs.mkdirSync(avatarDir, { recursive: true });
  }
  fs.copyFileSync(avatarSource, avatarTarget);
  console.log(`  ✅ Webview avatar copied`);
} else {
  console.warn(`  ⚠️  No avatar found at: assets/branding/avatar-icons/avatar.svg`);
}

console.log(`✅ Prebuild complete for ${extensionName}`);
