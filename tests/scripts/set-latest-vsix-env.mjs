import { appendFileSync } from 'fs';

const repoOwner = 'konveyor';
const repoName = 'editor-extensions';
const releaseTag = 'development-builds';

/**
 * Gets the latest dev build from https://github.com/konveyor/editor-extensions/releases/tag/development-builds
 * and appends the link and vsix file name to the .env file
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
  console.log(data);

  const asset = data.assets.findLast((a) => a.name.endsWith('.vsix'));
  if (!asset) {
    throw new Error('No .vsix asset found in release');
  }

  const envContent = `\nVSIX_DOWNLOAD_URL=${asset.browser_download_url}\n`;
  appendFileSync('.env', envContent);
  console.log('Generated .env with latest VSIX url');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
