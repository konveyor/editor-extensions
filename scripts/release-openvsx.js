#!/usr/bin/env node
/**
 * ============================================================================
 * OPENVSX RELEASE SCRIPT FOR KONVEYOR EDITOR EXTENSIONS
 * ============================================================================
 *
 * This script automates releasing Konveyor VS Code extensions to OpenVSX.
 *
 * TARGET REGISTRY: OpenVSX (https://open-vsx.org)
 * ─────────────────────────────────────────────────────────────────────────────
 * OpenVSX is an open-source alternative to the VS Code Marketplace, used by
 * VS Code forks like VSCodium, Cursor, Windsurf, and other open-source editors.
 * This script does NOT publish to the official VS Code Marketplace.
 *
 * Published extensions can be found at:
 *   https://open-vsx.org/namespace/konveyor
 *
 * ============================================================================
 * WHAT THIS SCRIPT DOES (IN ORDER)
 * ============================================================================
 *
 * 1. VERSION UPDATE
 *    - Reads the current version from the root package.json
 *    - Calculates the new version (from bump type or explicit version)
 *    - Updates ALL package.json files across the monorepo to the new version
 *
 * 2. BUILD (unless --skip-build)
 *    - Runs `npm run build` to compile all packages
 *    - Runs `npm run dist` to prepare the dist folder
 *    - Runs `npm run package` to create .vsix extension files
 *
 * 3. GIT COMMIT & TAG (unless --no-git)
 *    - Stages all modified package.json files
 *    - Creates a commit with message "chore: release vX.Y.Z"
 *    - Creates an annotated git tag "vX.Y.Z"
 *
 * 4. PUBLISH TO OPENVSX (unless --skip-publish)
 *    - Finds all .vsix files in dist/
 *    - Publishes each one to OpenVSX registry (https://open-vsx.org)
 *    - Requires OVSX_PAT env var or --openvsx-token flag
 *    - Uses the `ovsx` CLI tool (https://github.com/eclipse/openvsx)
 *
 * ============================================================================
 * PREREQUISITES
 * ============================================================================
 *
 * - Node.js and npm installed
 * - All dependencies installed (`npm install` in root)
 * - Git repository with no uncommitted changes (warning only)
 * - For publishing: OpenVSX personal access token (OVSX_PAT)
 *     → Get your token at: https://open-vsx.org/user-settings/tokens
 *     → Token needs "publish-extensions" permission
 *
 * ============================================================================
 * USAGE
 * ============================================================================
 *
 *   node scripts/release-openvsx.js <version> [options]
 *
 * VERSION ARGUMENT (required):
 *   patch       Bump the patch version (0.5.0 → 0.5.1)
 *   minor       Bump the minor version (0.5.0 → 0.6.0)
 *   major       Bump the major version (0.5.0 → 1.0.0)
 *   X.Y.Z       Set an explicit version (e.g., "0.5.0", "1.0.0-beta.1")
 *
 * OPTIONS:
 *   --dry-run           Preview all actions without making any changes.
 *                       Useful for verifying what will happen before a real release.
 *
 *   --skip-build        Skip the build/package steps. Use this if you've already
 *                       built the project and just want to tag/publish.
 *
 *   --skip-publish      Skip publishing to OpenVSX. Useful for local testing
 *                       or when you want to publish manually later.
 *
 *   --pre-release       Mark the packaged extensions as pre-release versions.
 *                       Adds --pre-release flag to the vsce package command.
 *
 *   --no-git            Skip creating the git commit and tag. Useful when you
 *                       want to review changes before committing, or for testing.
 *
 *   --openvsx-token     Provide the OpenVSX PAT directly (alternative to OVSX_PAT
 *                       environment variable).
 *
 *   --publisher         Set the OpenVSX namespace/publisher for all extensions.
 *                       This updates the "publisher" field in extension package.json
 *                       files before building. Useful for testing releases under a
 *                       personal namespace instead of the official "konveyor" namespace.
 *                       Example: --publisher myusername
 *
 * ============================================================================
 * EXAMPLES
 * ============================================================================
 *
 * # Preview what a patch release would do (safe, no changes made)
 * node scripts/release-openvsx.js patch --dry-run
 *
 * # Create a patch release (0.5.0 → 0.5.1), full pipeline
 * node scripts/release-openvsx.js patch
 *
 * # Create a minor release (0.5.0 → 0.6.0)
 * node scripts/release-openvsx.js minor
 *
 * # Set a specific version
 * node scripts/release-openvsx.js 1.0.0
 *
 * # Create a pre-release version
 * node scripts/release-openvsx.js 1.0.0-beta.1 --pre-release
 *
 * # Build and tag only, publish manually later
 * node scripts/release-openvsx.js patch --skip-publish
 *
 * # Update versions only, handle build/git/publish yourself
 * node scripts/release-openvsx.js patch --skip-build --no-git --skip-publish
 *
 * # Publish with explicit token
 * node scripts/release-openvsx.js patch --openvsx-token "your-token-here"
 *
 * # Full release with environment variable for token
 * OVSX_PAT="your-token" node scripts/release-openvsx.js patch
 *
 * # Publish to a different OpenVSX namespace (useful for testing)
 * node scripts/release-openvsx.js patch --publisher myusername
 *
 * # Test release to personal namespace without affecting official releases
 * node scripts/release-openvsx.js patch --publisher myusername --no-git
 *
 * ============================================================================
 * AFTER RUNNING THIS SCRIPT
 * ============================================================================
 *
 * If you used --no-git or the script succeeded with git:
 *   1. Review the commit:     git show HEAD
 *   2. Push to remote:        git push && git push --tags
 *   3. Create GitHub release: Go to GitHub → Releases → Draft new release
 *
 * If you used --skip-publish:
 *   Publish manually to OpenVSX:
 *     OVSX_PAT=<token> npx ovsx publish dist/*.vsix
 *
 * After publishing, verify your extensions at:
 *   https://open-vsx.org/namespace/konveyor
 *
 * NOTE: This script does NOT publish to the VS Code Marketplace.
 * To publish there, use `vsce publish` instead of `ovsx publish`.
 *
 * ============================================================================
 * PACKAGE.JSON FILES UPDATED
 * ============================================================================
 *
 * This script updates the "version" field in these files:
 *   - package.json                 (root workspace)
 *   - shared/package.json          (shared library)
 *   - agentic/package.json         (agentic package)
 *   - webview-ui/package.json      (webview UI)
 *   - vscode/core/package.json     (core extension)
 *   - vscode/java/package.json     (Java language pack)
 *   - vscode/javascript/package.json (JavaScript language pack)
 *   - vscode/go/package.json       (Go language pack)
 *   - vscode/csharp/package.json   (C# language pack)
 *
 * ============================================================================
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// -----------------------------------------------------------------------------
// CONFIGURATION
// -----------------------------------------------------------------------------

// ESM equivalent of __dirname (since import.meta.url gives us the file URL)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

/**
 * All package.json files that need version updates during a release.
 * Add new packages here if the monorepo structure changes.
 */
const PACKAGE_FILES = [
  "package.json", // Root workspace package
  "shared/package.json", // Shared utilities library
  "agentic/package.json", // Agentic AI package
  "webview-ui/package.json", // React webview UI
  "vscode/core/package.json", // Core VS Code extension
  "vscode/java/package.json", // Java language pack
  "vscode/javascript/package.json", // JavaScript language pack
  "vscode/go/package.json", // Go language pack
  "vscode/csharp/package.json", // C# language pack
];

/**
 * Extension package.json files that have a "publisher" field.
 * These determine the OpenVSX namespace where extensions are published.
 * Only these files are updated when --publisher is used.
 */
const EXTENSION_PACKAGE_FILES = [
  "vscode/core/package.json", // Core VS Code extension
  "vscode/java/package.json", // Java language pack
  "vscode/javascript/package.json", // JavaScript language pack
  "vscode/go/package.json", // Go language pack
  "vscode/csharp/package.json", // C# language pack
];

// -----------------------------------------------------------------------------
// ARGUMENT PARSING
// -----------------------------------------------------------------------------

/**
 * Parses command line arguments into an options object.
 *
 * @returns {Object} Parsed options with the following properties:
 *   - version: string|null - Version string or bump type (patch/minor/major)
 *   - dryRun: boolean - If true, show actions without executing them
 *   - skipBuild: boolean - If true, skip the build step
 *   - skipPublish: boolean - If true, skip OpenVSX publishing
 *   - preRelease: boolean - If true, mark as pre-release when packaging
 *   - noGit: boolean - If true, skip git commit and tag creation
 *   - openvsxToken: string|null - OpenVSX PAT for publishing
 *   - publisher: string|null - OpenVSX namespace/publisher to use
 */
function parseArgs() {
  // Skip first two args: node executable and script path
  const args = process.argv.slice(2);

  const options = {
    version: null,
    dryRun: false,
    skipBuild: false,
    skipPublish: false,
    preRelease: false,
    noGit: false,
    openvsxToken: process.env.OVSX_PAT || null, // Can be set via env var
    publisher: null, // OpenVSX namespace (e.g., "konveyor", "myusername")
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--skip-build") {
      options.skipBuild = true;
    } else if (arg === "--skip-publish") {
      options.skipPublish = true;
    } else if (arg === "--pre-release") {
      options.preRelease = true;
    } else if (arg === "--no-git") {
      options.noGit = true;
    } else if (arg === "--openvsx-token") {
      // Token is the next argument
      options.openvsxToken = args[++i];
    } else if (arg === "--publisher") {
      // Publisher/namespace is the next argument
      options.publisher = args[++i];
    } else if (!arg.startsWith("--")) {
      // Non-flag argument is the version
      options.version = arg;
    }
  }

  return options;
}

// -----------------------------------------------------------------------------
// VERSION UTILITIES
// -----------------------------------------------------------------------------

/**
 * Parses a semver version string into its components.
 *
 * Supports standard semver format: MAJOR.MINOR.PATCH[-PRERELEASE]
 * Examples: "1.0.0", "0.5.1", "2.0.0-beta.1", "1.0.0-rc.2"
 *
 * @param {string} version - The version string to parse
 * @returns {Object} Parsed version with major, minor, patch, and prerelease
 * @throws {Error} If the version format is invalid
 */
function parseVersion(version) {
  // Regex breakdown:
  // ^(\d+)     - Major version (required, start of string)
  // \.(\d+)    - Minor version (required, after first dot)
  // \.(\d+)    - Patch version (required, after second dot)
  // (-.*)?$    - Prerelease suffix (optional, e.g., "-beta.1")
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(-.*)?$/);

  if (!match) {
    throw new Error(`Invalid version format: ${version}`);
  }

  return {
    major: parseInt(match[1]),
    minor: parseInt(match[2]),
    patch: parseInt(match[3]),
    prerelease: match[4] || "",
  };
}

/**
 * Calculates the new version based on bump type or explicit version.
 *
 * @param {string} currentVersion - The current version (e.g., "0.5.0")
 * @param {string} input - Either a bump type ("patch", "minor", "major") or explicit version
 * @returns {string} The new version string
 *
 * @example
 * calculateNewVersion("0.5.0", "patch")  // Returns "0.5.1"
 * calculateNewVersion("0.5.0", "minor")  // Returns "0.6.0"
 * calculateNewVersion("0.5.0", "major")  // Returns "1.0.0"
 * calculateNewVersion("0.5.0", "1.0.0")  // Returns "1.0.0"
 */
function calculateNewVersion(currentVersion, input) {
  const current = parseVersion(currentVersion);

  if (input === "patch") {
    // Increment patch: 0.5.0 → 0.5.1
    return `${current.major}.${current.minor}.${current.patch + 1}`;
  } else if (input === "minor") {
    // Increment minor, reset patch: 0.5.3 → 0.6.0
    return `${current.major}.${current.minor + 1}.0`;
  } else if (input === "major") {
    // Increment major, reset minor and patch: 0.5.3 → 1.0.0
    return `${current.major + 1}.0.0`;
  } else {
    // Explicit version provided - validate it's a proper semver
    parseVersion(input);
    return input;
  }
}

/**
 * Reads the current version from the root package.json.
 *
 * @returns {string} The current version (e.g., "0.5.0")
 */
function getCurrentVersion() {
  const packagePath = path.join(projectRoot, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  return packageJson.version;
}

/**
 * Updates the version in a single package.json file.
 *
 * @param {string} filePath - Relative path to package.json from project root
 * @param {string} newVersion - The new version to set
 * @param {boolean} dryRun - If true, don't actually write the file
 * @returns {boolean} True if the file was updated, false if skipped
 */
function updatePackageVersion(filePath, newVersion, dryRun) {
  const fullPath = path.join(projectRoot, filePath);

  // Skip if file doesn't exist (e.g., optional package)
  if (!fs.existsSync(fullPath)) {
    console.log(`  ⚠️  Skipping ${filePath} (not found)`);
    return false;
  }

  const content = fs.readFileSync(fullPath, "utf8");
  const packageJson = JSON.parse(content);
  const oldVersion = packageJson.version;

  // Skip if already at the target version
  if (oldVersion === newVersion) {
    console.log(`  ✓ ${filePath} (already ${newVersion})`);
    return false;
  }

  packageJson.version = newVersion;

  if (!dryRun) {
    // Write with 2-space indentation and trailing newline (standard formatting)
    fs.writeFileSync(fullPath, JSON.stringify(packageJson, null, 2) + "\n");
  }

  console.log(`  ✓ ${filePath}: ${oldVersion} → ${newVersion}`);
  return true;
}

/**
 * Updates the publisher field in an extension's package.json file.
 *
 * The publisher determines the OpenVSX namespace where the extension
 * will be published (e.g., "konveyor" → https://open-vsx.org/namespace/konveyor).
 *
 * @param {string} filePath - Relative path to package.json from project root
 * @param {string} newPublisher - The new publisher/namespace to set
 * @param {boolean} dryRun - If true, don't actually write the file
 * @returns {boolean} True if the file was updated, false if skipped
 */
function updatePackagePublisher(filePath, newPublisher, dryRun) {
  const fullPath = path.join(projectRoot, filePath);

  // Skip if file doesn't exist
  if (!fs.existsSync(fullPath)) {
    console.log(`  ⚠️  Skipping ${filePath} (not found)`);
    return false;
  }

  const content = fs.readFileSync(fullPath, "utf8");
  const packageJson = JSON.parse(content);
  const oldPublisher = packageJson.publisher;

  // Skip if already set to the target publisher
  if (oldPublisher === newPublisher) {
    console.log(`  ✓ ${filePath} (already "${newPublisher}")`);
    return false;
  }

  packageJson.publisher = newPublisher;

  if (!dryRun) {
    fs.writeFileSync(fullPath, JSON.stringify(packageJson, null, 2) + "\n");
  }

  console.log(`  ✓ ${filePath}: "${oldPublisher}" → "${newPublisher}"`);
  return true;
}

/**
 * Updates extension dependency references in a package.json file.
 *
 * When changing the publisher, extension dependencies that reference
 * "konveyor.konveyor-core" need to be updated to use the new publisher
 * (e.g., "ibolton336.konveyor-core").
 *
 * This updates:
 * - extensionDependencies array
 * - coreExtensionId field
 *
 * @param {string} filePath - Relative path to package.json from project root
 * @param {string} newPublisher - The new publisher/namespace
 * @param {boolean} dryRun - If true, don't actually write the file
 * @returns {boolean} True if the file was updated, false if skipped
 */
function updateExtensionDependencies(filePath, newPublisher, dryRun) {
  const fullPath = path.join(projectRoot, filePath);

  if (!fs.existsSync(fullPath)) {
    return false;
  }

  const content = fs.readFileSync(fullPath, "utf8");
  const packageJson = JSON.parse(content);
  let updated = false;

  // Update coreExtensionId if present
  if (packageJson.coreExtensionId === "konveyor.konveyor-core") {
    packageJson.coreExtensionId = `${newPublisher}.konveyor-core`;
    updated = true;
  }

  // Update extensionDependencies array
  if (Array.isArray(packageJson.extensionDependencies)) {
    packageJson.extensionDependencies = packageJson.extensionDependencies.map((dep) => {
      if (dep === "konveyor.konveyor-core") {
        updated = true;
        return `${newPublisher}.konveyor-core`;
      }
      return dep;
    });
  }

  // Update extensionPack array (for meta-package)
  if (Array.isArray(packageJson.extensionPack)) {
    packageJson.extensionPack = packageJson.extensionPack.map((ext) => {
      if (ext.startsWith("konveyor.")) {
        updated = true;
        return ext.replace("konveyor.", `${newPublisher}.`);
      }
      return ext;
    });
  }

  if (updated) {
    if (!dryRun) {
      fs.writeFileSync(fullPath, JSON.stringify(packageJson, null, 2) + "\n");
    }
    console.log(`  ✓ ${filePath}: updated extension dependencies`);
  }

  return updated;
}

// -----------------------------------------------------------------------------
// SHELL EXECUTION UTILITIES
// -----------------------------------------------------------------------------

/**
 * Runs a shell command with error handling and dry-run support.
 *
 * @param {string} command - The shell command to execute
 * @param {Object} options - Execution options
 * @param {boolean} options.dryRun - If true, only log the command without executing
 * @param {boolean} options.silent - If true, capture output instead of streaming to console
 * @param {string} options.cwd - Working directory for the command
 * @returns {string} Command output (empty string if dryRun or stdio is inherited)
 * @throws {Error} If the command fails (exit code !== 0)
 */
function run(command, options = {}) {
  const { dryRun = false, silent = false, cwd = projectRoot } = options;

  if (dryRun) {
    console.log(`  [dry-run] ${command}`);
    return "";
  }

  try {
    const result = execSync(command, {
      cwd,
      encoding: "utf8",
      // "inherit" streams output directly to console
      // "pipe" captures output and returns it
      stdio: silent ? "pipe" : "inherit",
    });
    return result || "";
  } catch (error) {
    // Log any captured output before re-throwing
    if (error.stdout) {
      console.log(error.stdout);
    }
    if (error.stderr) {
      console.error(error.stderr);
    }
    throw error;
  }
}

/**
 * Checks if there are uncommitted changes in the git repository.
 * Used to warn the user before creating a release commit.
 *
 * @returns {boolean} True if there are uncommitted changes
 */
function hasUncommittedChanges() {
  try {
    // --porcelain gives machine-readable output: empty = clean, non-empty = changes
    const result = execSync("git status --porcelain", {
      cwd: projectRoot,
      encoding: "utf8",
    });
    return result.trim().length > 0;
  } catch {
    // If git command fails (e.g., not a git repo), assume no changes
    return false;
  }
}

// -----------------------------------------------------------------------------
// MAIN RELEASE WORKFLOW
// -----------------------------------------------------------------------------

/**
 * Main release workflow function.
 *
 * Orchestrates the entire release process:
 * 1. Parse and validate arguments
 * 2. Calculate new version
 * 3. Update all package.json files
 * 4. Build and package extensions
 * 5. Create git commit and tag
 * 6. Publish to OpenVSX
 *
 * Each step can be skipped via command line flags.
 */
async function release() {
  console.log("\n🚀 Konveyor Editor Extensions Release Script\n");

  // -------------------------------------------------------------------------
  // STEP 0: Parse arguments and show help if needed
  // -------------------------------------------------------------------------
  const options = parseArgs();

  if (!options.version) {
    // No version provided - show usage help and exit
    console.log("Usage: node scripts/release-openvsx.js [version] [options]\n");
    console.log("Arguments:");
    console.log(
      '  version    New version (e.g., "0.5.0") or bump type: "patch", "minor", "major"\n',
    );
    console.log("Options:");
    console.log("  --dry-run           Show what would be done without making changes");
    console.log("  --skip-build        Skip the build step");
    console.log("  --skip-publish      Skip publishing to OpenVSX");
    console.log("  --pre-release       Mark as pre-release when packaging");
    console.log("  --no-git            Don't create git commit/tag");
    console.log("  --openvsx-token     OpenVSX token (or set OVSX_PAT env var)");
    console.log("  --publisher         OpenVSX namespace/publisher (e.g., 'konveyor')\n");
    console.log("Examples:");
    console.log("  node scripts/release-openvsx.js patch");
    console.log("  node scripts/release-openvsx.js 0.5.0 --dry-run");
    console.log("  node scripts/release-openvsx.js minor --skip-publish");
    console.log("  node scripts/release-openvsx.js patch --publisher myusername\n");
    process.exit(1);
  }

  if (options.dryRun) {
    console.log("🔍 DRY RUN MODE - No changes will be made\n");
  }

  // -------------------------------------------------------------------------
  // STEP 1: Calculate and display version change
  // -------------------------------------------------------------------------
  const currentVersion = getCurrentVersion();
  const newVersion = calculateNewVersion(currentVersion, options.version);

  console.log(`📦 Version: ${currentVersion} → ${newVersion}\n`);

  // Warn about uncommitted changes (doesn't block the release)
  if (!options.noGit && hasUncommittedChanges()) {
    console.log("⚠️  Warning: You have uncommitted changes\n");
  }

  // -------------------------------------------------------------------------
  // STEP 2: Update version in all package.json files
  // -------------------------------------------------------------------------
  console.log("📝 Updating package.json files...");
  let updatedFiles = 0;
  for (const file of PACKAGE_FILES) {
    if (updatePackageVersion(file, newVersion, options.dryRun)) {
      updatedFiles++;
    }
  }
  console.log(`   Updated ${updatedFiles} file(s)\n`);

  // -------------------------------------------------------------------------
  // STEP 2b: Update publisher in extension package.json files (if --publisher)
  // -------------------------------------------------------------------------
  if (options.publisher) {
    console.log(`👤 Updating publisher to "${options.publisher}"...`);
    let updatedPublishers = 0;
    for (const file of EXTENSION_PACKAGE_FILES) {
      if (updatePackagePublisher(file, options.publisher, options.dryRun)) {
        updatedPublishers++;
      }
    }
    console.log(`   Updated ${updatedPublishers} file(s)\n`);

    // Also update extension dependencies to reference the new publisher
    console.log(`🔗 Updating extension dependencies to use "${options.publisher}"...`);
    let updatedDeps = 0;
    for (const file of EXTENSION_PACKAGE_FILES) {
      if (updateExtensionDependencies(file, options.publisher, options.dryRun)) {
        updatedDeps++;
      }
    }
    // Also check the meta-package
    if (
      updateExtensionDependencies("vscode/konveyor/package.json", options.publisher, options.dryRun)
    ) {
      updatedDeps++;
    }
    console.log(`   Updated ${updatedDeps} file(s)\n`);

    console.log(
      `   Extensions will be published to: https://open-vsx.org/namespace/${options.publisher}\n`,
    );
  }

  // -------------------------------------------------------------------------
  // STEP 3: Build and package (unless --skip-build)
  // -------------------------------------------------------------------------
  if (!options.skipBuild) {
    // Build: Compile TypeScript, bundle assets, etc.
    console.log("🔨 Building all packages...");
    run("npm run build", { dryRun: options.dryRun });
    console.log("   Build complete\n");

    // Dist: Copy built artifacts to dist/ folder structure
    console.log("📁 Creating dist folder...");
    run("npm run dist", { dryRun: options.dryRun });
    console.log("   Dist folder ready\n");

    // Package: Create .vsix files for each extension
    console.log("📦 Packaging extensions...");
    const preReleaseFlag = options.preRelease ? " --pre-release" : "";
    run(`npm run package${preReleaseFlag}`, { dryRun: options.dryRun });
    console.log("   Packaging complete\n");
  } else {
    console.log("⏭️  Skipping build (--skip-build)\n");
  }

  // -------------------------------------------------------------------------
  // STEP 4: Create git commit and tag (unless --no-git)
  // -------------------------------------------------------------------------
  if (!options.noGit) {
    console.log("📌 Creating git commit and tag...");

    // Stage all package.json files that were modified
    for (const file of PACKAGE_FILES) {
      const fullPath = path.join(projectRoot, file);
      if (fs.existsSync(fullPath)) {
        run(`git add ${file}`, { dryRun: options.dryRun, silent: true });
      }
    }

    // Create the release commit
    run(`git commit -m "chore: release v${newVersion}"`, { dryRun: options.dryRun });

    // Create an annotated tag (includes message and author info)
    run(`git tag -a v${newVersion} -m "Release v${newVersion}"`, { dryRun: options.dryRun });
    console.log(`   Created tag v${newVersion}\n`);
  } else {
    console.log("⏭️  Skipping git commit/tag (--no-git)\n");
  }

  // -------------------------------------------------------------------------
  // STEP 5: Publish to OpenVSX (unless --skip-publish)
  // -------------------------------------------------------------------------
  if (!options.skipPublish) {
    if (!options.openvsxToken) {
      // No token available - skip publishing with helpful message
      console.log("⚠️  Skipping OpenVSX publish: No token provided");
      console.log("   Set OVSX_PAT environment variable or use --openvsx-token\n");
    } else {
      console.log("🌐 Publishing to OpenVSX...");

      // Find all .vsix files in the dist directory
      const distDir = path.join(projectRoot, "dist");
      if (fs.existsSync(distDir)) {
        const vsixFiles = fs.readdirSync(distDir).filter((f) => f.endsWith(".vsix"));

        if (vsixFiles.length === 0) {
          console.log("   ⚠️  No VSIX files found in dist/\n");
        } else {
          // Publish each extension
          for (const vsixFile of vsixFiles) {
            const vsixPath = path.join(distDir, vsixFile);
            console.log(`   Publishing ${vsixFile}...`);

            if (!options.dryRun) {
              try {
                // Use ovsx CLI to publish to OpenVSX registry (https://open-vsx.org)
                // Note: This does NOT publish to VS Code Marketplace
                execSync(`npx ovsx publish "${vsixPath}" -p "${options.openvsxToken}"`, {
                  cwd: projectRoot,
                  stdio: "inherit",
                });
                console.log(`   ✓ ${vsixFile} published successfully`);
              } catch (error) {
                console.error(`   ✗ Failed to publish ${vsixFile}`);
                throw error;
              }
            } else {
              console.log(`   [dry-run] npx ovsx publish "${vsixPath}"`);
            }
          }
          console.log();
        }
      } else {
        console.log("   ⚠️  dist/ directory not found\n");
      }
    }
  } else {
    console.log("⏭️  Skipping OpenVSX publish (--skip-publish)\n");
  }

  // -------------------------------------------------------------------------
  // STEP 6: Show summary and next steps
  // -------------------------------------------------------------------------
  console.log("✅ Release complete!\n");

  // Show where extensions were/will be published
  const namespace = options.publisher || "konveyor";
  console.log(`📍 OpenVSX namespace: https://open-vsx.org/namespace/${namespace}\n`);

  console.log("Next steps:");
  if (!options.noGit) {
    console.log(`  1. Review the commit: git show HEAD`);
    console.log(`  2. Push changes: git push && git push --tags`);
  }
  if (options.skipPublish || !options.openvsxToken) {
    console.log(`  3. Publish manually: OVSX_PAT=<token> npx ovsx publish dist/*.vsix`);
  }
  if (options.publisher) {
    console.log(`\n⚠️  Note: Publisher was changed to "${options.publisher}".`);
    console.log(`   Remember to revert if this was for testing.`);
  }
  console.log();
}

// -----------------------------------------------------------------------------
// SCRIPT ENTRY POINT
// -----------------------------------------------------------------------------

// Run the release workflow and handle any errors
release().catch((error) => {
  console.error("\n❌ Release failed:", error.message);
  process.exit(1);
});
