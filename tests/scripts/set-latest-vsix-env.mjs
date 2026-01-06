import { appendFileSync } from 'fs';

const repoOwner = 'konveyor';
const repoName = 'editor-extensions';
const releaseTag = 'development-builds';

/**
 * Gets the latest dev builds from https://github.com/konveyor/editor-extensions/releases/tag/development-builds
 * and appends the links and vsix file names to the .env file for each extension type:
 * - CORE_VSIX_DOWNLOAD_URL (konveyor-X.X.X-dev.*.vsix)
 * - JAVA_VSIX_DOWNLOAD_URL (konveyor-java-X.X.X-dev.*.vsix)
 * - JAVASCRIPT_VSIX_DOWNLOAD_URL (konveyor-javascript-X.X.X-dev.*.vsix)
 * - GO_VSIX_DOWNLOAD_URL (konveyor-go-X.X.X-dev.*.vsix)
 * @return {Promise<void>}
 */
async function main() {
  const res = await fetch(
    `https://api.github.com/repos/${repoOwner}/${repoName}/releases/tags/${releaseTag}`
  );
  if (!res.ok) {
    throw new Error(`GitHub API request failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  const vsixAssets = data.assets.filter((a) => a.name.endsWith('.vsix'));

  // Define the patterns for each extension type
  // Core: konveyor-X.X.X-dev.*.vsix (no language suffix after "konveyor-")
  // Language-specific: konveyor-{language}-X.X.X-dev.*.vsix
  const extensions = [
    { name: 'CORE', pattern: /^konveyor-\d+\.\d+\.\d+-dev\..*\.vsix$/ },
    { name: 'JAVA', pattern: /^konveyor-java-\d+\.\d+\.\d+-dev\..*\.vsix$/ },
    { name: 'JAVASCRIPT', pattern: /^konveyor-javascript-\d+\.\d+\.\d+-dev\..*\.vsix$/ },
    { name: 'GO', pattern: /^konveyor-go-\d+\.\d+\.\d+-dev\..*\.vsix$/ },
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
