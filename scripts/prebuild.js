#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Determine branding from environment or default to konveyor
const brandingName = process.env.BRANDING || "konveyor";

console.log(`🔄 Running prebuild script with branding: ${brandingName}`);

// Read branding strings from package.json
const packagePath = path.join(__dirname, "../vscode/package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));

let brandingStrings;
try {
  brandingStrings = packageJson.branding[brandingName];
  if (!brandingStrings) {
    throw new Error(`Branding configuration '${brandingName}' not found in package.json`);
  }
} catch (error) {
  console.error(
    `❌ Could not read branding configuration '${brandingName}' from package.json:`,
    error,
  );
  process.exit(1);
}

console.log(`📦 Transforming package.json for ${brandingStrings.productName}...`);

// Apply core branding transformations
Object.assign(packageJson, {
  name: brandingStrings.extensionName,
  displayName: brandingStrings.displayName,
  description: brandingStrings.description,
  publisher: brandingStrings.publisher,
  author: brandingStrings.author,
  icon: brandingStrings.icon,
});

// Transform configuration properties
if (packageJson.contributes?.configuration?.properties) {
  const props = packageJson.contributes.configuration.properties;
  const newProps = {};

  Object.keys(props).forEach((key) => {
    const newKey = key.replace(/^[^.]+\./, `${brandingStrings.configPrefix}.`);
    newProps[newKey] = props[key];
  });

  packageJson.contributes.configuration.properties = newProps;
  packageJson.contributes.configuration.title = brandingStrings.productName;
}

// Transform commands
if (packageJson.contributes?.commands) {
  // Categories that should not be transformed by branding
  const preservedCategories = ["diffEditor"];

  packageJson.contributes.commands = packageJson.contributes.commands.map((cmd) => ({
    ...cmd,
    command: cmd.command.replace(/^[^.]+\./, `${brandingStrings.commandPrefix}.`),
    // Only transform category if it's not in the preserved list
    category: preservedCategories.includes(cmd.category) ? cmd.category : brandingStrings.category,
    // Handle bidirectional transformation for titles
    title: cmd.title?.replace(/(Konveyor|MTA)/g, brandingStrings.productName) || cmd.title,
  }));
}

// Transform views and containers
if (packageJson.contributes?.viewsContainers?.activitybar) {
  packageJson.contributes.viewsContainers.activitybar =
    packageJson.contributes.viewsContainers.activitybar.map((container) => ({
      ...container,
      id: brandingStrings.viewPrefix,
      title: brandingStrings.productName,
      icon: brandingStrings.icon,
    }));
}

if (packageJson.contributes?.views) {
  const newViews = {};
  Object.keys(packageJson.contributes.views).forEach((viewKey) => {
    newViews[brandingStrings.viewPrefix] = packageJson.contributes.views[viewKey].map((view) => ({
      ...view,
      id: view.id.replace(/^[^.]+\./, `${brandingStrings.viewPrefix}.`),
      name: view.name.replace(/\b\w+/, brandingStrings.productName),
    }));
  });
  packageJson.contributes.views = newViews;
}

// Transform menus
if (packageJson.contributes?.menus) {
  const transformMenuCommands = (menuItems) => {
    return menuItems.map((item) => ({
      ...item,
      command: item.command?.replace(/^[^.]+\./, `${brandingStrings.commandPrefix}.`),
      when: item.when
        // Handle bidirectional transformation for any existing branding
        ?.replace(/(konveyor|mta)\.issueView/g, `${brandingStrings.viewPrefix}.issueView`)
        .replace(/(konveyor|mta)(?=\s|$)/g, brandingStrings.viewPrefix),
      submenu: item.submenu?.replace(/^(konveyor|mta)\./, `${brandingStrings.viewPrefix}.`),
    }));
  };

  const newMenus = {};
  Object.keys(packageJson.contributes.menus).forEach((menuKey) => {
    // Handle bidirectional transformation for menu keys
    const newMenuKey =
      menuKey.includes("konveyor") || menuKey.includes("mta")
        ? menuKey.replace(/(konveyor|mta)/g, brandingStrings.viewPrefix)
        : menuKey;
    newMenus[newMenuKey] = transformMenuCommands(packageJson.contributes.menus[menuKey]);
  });
  packageJson.contributes.menus = newMenus;
}

// Transform submenus
if (packageJson.contributes?.submenus) {
  packageJson.contributes.submenus = packageJson.contributes.submenus.map((submenu) => ({
    ...submenu,
    id: submenu.id.replace(/^(konveyor|mta)/, `${brandingStrings.viewPrefix}`),
    label: `${brandingStrings.productName} Actions`,
  }));
}

// Skip activation events transformation - not needed for MTA branding

// Write the transformed package.json
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));

console.log(`✅ ${brandingStrings.productName} branding transformations complete`);
