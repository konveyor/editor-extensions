import { appendFileSync } from 'fs';

// Determine repo owner and extension prefix based on TEST_CATEGORY env var
const testCategory = process.env.TEST_CATEGORY || 'konveyor';
const repoOwner = testCategory.toLowerCase() !== 'konveyor' ? 'migtools' : 'konveyor';
const extensionPrefix = testCategory.toLowerCase();
const repoName = 'editor-extensions';
const releaseTag = process.env.TEST_VERSION_TAG || 'development-builds';

/**
 * Gets the latest builds from GitHub releases and appends the links and vsix file names
 * to the .env file for each extension type.
 *
 * Environment variables:
 * - TEST_CATEGORY: Determines repo owner and extension prefix
 *   - If not "konveyor" (case-insensitive), uses "migtools" as repo owner
 *     and TEST_CATEGORY.toLowerCase() as extension prefix
 *   - Otherwise, uses "konveyor" for both
 * - TEST_VERSION_TAG: Release tag to fetch from (default: "development-builds")
 *
 * Generated env vars:
 * - CORE_VSIX_DOWNLOAD_URL ({prefix}-core-X.X.X*.vsix)
 * - JAVA_VSIX_DOWNLOAD_URL ({prefix}-java-X.X.X*.vsix)
 * - JAVASCRIPT_VSIX_DOWNLOAD_URL ({prefix}-javascript-X.X.X*.vsix)
 * - GO_VSIX_DOWNLOAD_URL ({prefix}-go-X.X.X*.vsix)
 * @return {Promise<void>}
 */
async function main() {
  console.log('VSIX Fetch Configuration:');
  console.log(
    `  TEST_CATEGORY: ${process.env.TEST_CATEGORY || '(not set)'} -> extensionPrefix: ${extensionPrefix}`
  );
  console.log(
    `  TEST_VERSION_TAG: ${process.env.TEST_VERSION_TAG || '(not set)'} -> releaseTag: ${releaseTag}`
  );
  console.log(`  Repository owner: ${repoOwner}`);

  const fetchUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/releases/tags/${releaseTag}`;
  console.log(`\nFetching from: ${fetchUrl}`);

  const res = await fetch(fetchUrl);
  if (!res.ok) {
    throw new Error(`GitHub API request failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  const vsixAssets = data.assets.filter((a) => a.name.endsWith('.vsix'));

  // Define the patterns for each extension type
  // Core: {prefix}-core-X.X.X*.vsix
  // Language-specific: {prefix}-{language}-X.X.X*.vsix
  const extensions = [
    {
      name: 'CORE',
      pattern: new RegExp(`^${extensionPrefix}-core-\\d+\\.\\d+\\.\\d+.*\\.vsix$`),
    },
    {
      name: 'JAVA',
      pattern: new RegExp(`^${extensionPrefix}-java-\\d+\\.\\d+\\.\\d+.*\\.vsix$`),
    },
    {
      name: 'JAVASCRIPT',
      pattern: new RegExp(`^${extensionPrefix}-javascript-\\d+\\.\\d+\\.\\d+.*\\.vsix$`),
    },
    {
      name: 'GO',
      pattern: new RegExp(`^${extensionPrefix}-go-\\d+\\.\\d+\\.\\d+.*\\.vsix$`),
    },
  ];

  let envContent = '\n';

  for (const ext of extensions) {
    // Filter assets matching the pattern, sort by created_at descending, take the first (latest)
    const matchingAssets = vsixAssets
      .filter((a) => ext.pattern.test(a.name))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const asset = matchingAssets[0];
    if (!asset) {
      console.warn(`No .vsix asset found for ${ext.name}`);
      continue;
    }
    envContent += `${ext.name}_VSIX_DOWNLOAD_URL=${asset.browser_download_url}\n`;
    console.log(`Found ${ext.name}: ${asset.name} (created: ${asset.created_at})`);
  }

  appendFileSync('.env', envContent);
  console.log('Generated .env with latest VSIX urls');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
