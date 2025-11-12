# Konveyor Editor Extensions

## Build and Test Status

| Branch | Last Merge CI                                                                                                                                                                                                   | Nightly CI                                                                                                                                                                                                                                    |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| main   | [![CI (repo level)](https://github.com/konveyor/editor-extensions/actions/workflows/ci-repo.yml/badge.svg?branch=main&event=push)](https://github.com/konveyor/editor-extensions/actions/workflows/ci-repo.yml) | [![Nightly CI (repo level)](https://github.com/konveyor/editor-extensions/actions/workflows/nightly-ci-repo.yaml/badge.svg?branch=main&event=schedule)](https://github.com/konveyor/editor-extensions/actions/workflows/nightly-ci-repo.yaml) |

This repository contains the assets and source code for editor extensions.

# Editor Extensions for Konveyor

This project is a VS Code extension designed to assist with migrating and modernizing applications using Konveyor. The extension includes a web-based UI built with Vite and an extension backend bundled with Webpack.

## Getting Started

To set up and run the extension, follow the steps below.

### Prerequisites

Ensure that you have the following installed:

- [Node.js](https://nodejs.org/) (LTS version recommended - see [.nvmrc](.nvmrc) for the version used by the project)
- [npm](https://www.npmjs.com/) (v10.5.2 or higher - enforced by engine requirements)
- [Visual Studio Code](https://code.visualstudio.com/)

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/konveyor/editor-extensions
   cd editor-extensions
   ```

2. Install the dependencies for both the extension and the web UI:

   ```bash
   npm install
   ```

3. Download the necessary assets to run the Kai server:

   For development (recommended):

   ```bash
   # This will fetch the latest assets from main branch
   # Requires GitHub CLI (gh) to be installed and authenticated
   npm run collect-assets:dev
   ```

   For release version:

   ```bash
   # This will fetch assets from release v0.1.0 (default)
   # To use a different release version:
   # npm run collect-assets -- --release-tag=v0.1.1
   npm run collect-assets
   ```

   Note: For development, we recommend using `collect-assets:dev` as it ensures your runtime assets match the latest code from the main branch. The regular `collect-assets` command uses a specific release version which may be outdated for development purposes.

### Running the Extension in Development Mode

Once you've installed all dependencies, and downloaded the runtime assets, you can run the
extension in development mode by following these steps:

Press the F5 key inside Visual Studio Code to open a new Extension Development Host window.

This command starts the `npm run dev` script, performing the following actions:

- Compiles the shared code in watch mode
- Starts the Vite dev server for the webview UI
- Compiles the vscode extension in watch mode (to automatically rebuild the extension on file changes)

Note: The extension requires vscode to be open on a workspace. It will not be visible in the
Extension Development Host window until you open a folder.

Inside the Extension Development Host window, press Ctrl+Shift+P (or Cmd+Shift+P on Mac) to open
the Command Palette and type `View: Show Konveyor` to open the Konveyor UI within the host.

### Watch Mode

If you want to run the extension in watch mode separately:

Use the following npm command to run the extension and webview UI in watch mode:

```bash
npm run dev
```

### Linting and formatting code

The `eslint` and `prettier` packages are used across the repo to standardize formatting and enforce
some code conventions. At `npm install` time, a git pre-commit hook is setup by [husky](https://github.com/typicode/husky) that will run [lint-staged](https://github.com/lint-staged/lint-staged) when
`git commit` is run. This will run `eslint` and `prettier` rule and formatting against any staged
changes. Keeping these steps automated at `git commit` time helps ensure consistent formatting
and fewer linting fails in CI.

## Building the Extension into a vsix archive that can be installed to vscode

To build the extension and generate a vsix, run the following commands:

```bash
npm run build
npm run collect-assets
npm run dist
npm run package
```

These command:

- Compiles the shared, webview-ui and vcsode sources using Vite and Webpack
- Download all of the runtime assets required
- Copy everything needed for the vsix to the `dist/` folder
- Package the contents of `dist/` into a vsix archive

When packaging is complete, the vsix will be `dist/konveyor-ai-0.1.0.vsix` (version number will match
the `vscode/package.json` version number).

## Downloading the extension's runtime assets

The extension requires a few assets to be downloaded and available to function. While preparing
the dev environment, or when packaging, the extension will download GitHub release asset and
extract the necessary component.

The core components needed to support the extension are:

- **kai analyzer rpc server** &rarr; The json-rpc server manages source code analysis.

- **jdt.ls bundle** &rarr; To support the use of jdt.ls by the analyzer, the
  [Konveyor java-analyzer-bundle](https://github.com/konveyor/java-analyzer-bundle) is used.

- **opensource labels file** &rarr; A maven index file of open source libraries used by the analyzer.

- **rulesets** &rarr; Base set of [Konveyor's static code analysis rules](https://github.com/konveyor/rulesets)
  to drive analysis.

All of these components are downloaded and unpacked into the correct place by the [collect-assets.js](./scripts/collect-assets.js)
script. There are cli parameters to override the default configuration values. The assets can be
downloaded from a GitHub release, or for a GitHub action workflow artifacts.

The base use case to download everything from the default release locations:

```bash
npm run collect-assets
```

To download from a specific release `v01.0-special.0`:

```bash
npm run collect-assets -- --release-tag=v0.1.0-special.0
```

To download from a release in a fork of the kai repository:

```bash
npm run collect-assets -- \
    --org=myUserName1 \
    --repo=kaiForked \
    --release=v0.1.2
```

To download from the latest successful build workflow on the head of the main branch of the kai repository:

```bash
GITHUB_TOKEN=$(gh auth token) npm run collect-assets -- --use-workflow-artifacts
```

To download from the latest successful build workflow for a specific PR:

```bash
GITHUB_TOKEN=$(gh auth token) npm run collect-assets -- --use-workflow-artifacts --pr=123
```

### GITHUB_TOKEN for collect-assets

Using a `GITHUB_TOKEN` is good to avoid rate limiting when downloading from the releases,
and to allow the download of workflow artifacts. Workflow artifacts may only be downloaded
by a user who is logged in to GitHub. The REST api verifies the user as logged in using a bearer
token. The collect-asset script will send the bearer token as long as it is set in the `GITHUB_TOKEN`
environment variable.

There are a few common ways to get your token:

- Use the `gh` [command line tool](https://cli.github.com/) to [login](https://cli.github.com/manual/gh_auth_login).
  Once logged in, the command `gh auth token` will show your token. The bash command to use the workflow artifacts
  as the download source uses this as the source for the bearer token.

- Open the [Tokens page](https://github.com/settings/tokens) on GitHub and generate a new token.
  - For new tokens, only the **Public repositories** "Read-only access to public repositories" access is needed.

  - For classic tokens, only the **public_repo** scope is needed.

## Project Structure

The project uses a number of npm workspaces to organize the code.

Project workspaces:

- [`extra-types`](./extra-types/) <br>
  Extra TypeScript types useful in our projects (i.e. make types on `[].filter(Boolean)` act nicely).

- [`shared`](./shared/) <br>
  Contains the types and code shared between the workspaces, especially types and actions
  that bridge vscode extension code to the webview code.

- [`vscode`](./vscode/) <br>
  The main vscode extension sources. Webpack is used to transpile and package the extension.
  In dev mode, webviews are dynamically incorporated via the vite dev server. In build mode,
  webview packaged code is copied in place and accessed statically.

- [`webview-ui`](./webview-ui/) <br>
  Webview UI sources built with React and PatternFly. Vite is used to transpile and package
  the views.

- [`agentic`](./agentic/) <br>
  Contains the agentic workflows that support generating solutions.

- [`test`](tests/) <br>
  End-to-end (E2E) tests built with Playwright.

Non workspace folders:

- [`docs`](./docs/) <br>
  Project documentation, roadmaps and wireframes.

- [`scripts`](./scripts/) <br>
  Javascript scripts used to setup the environment, build, and package the project.

## Versioning & Release Policy

We follow a structured odd/even release scheme to keep prereleases and stable releases predictable.

This strategy intentionally works around the VS Code Marketplace not supporting SemVer pre-release identifiers. Per the official docs, only major.minor.patch is supported and pre-releases must use distinct versions published with the `--pre-release` flag; the docs recommend using even minor versions for stable and odd minor versions for pre-release series (for example, 0.2._ release vs 0.3._ pre-release). See: [VS Code – Pre-release extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#prerelease-extensions).

- Main branch:
  - package.json is always pinned to the next even minor version (e.g. 0.4.0, 0.6.0, …).
  - Merges to main do not change this version directly.
  - Prereleases are published from tags on main using odd minor numbers (0.3.Z, 0.5.Z, …).
- Prereleases:
  - Tagging a commit on main with an odd-minor version (e.g. v0.3.4) publishes a prerelease (vsce publish --pre-release).
  - CI computes patch numbers from the latest tag, so prereleases increment sequentially (0.3.1, 0.3.2, …).
- Stable releases:
  - When ready, cut a release/X.Y branch where Y is even. Example: release/0.4.
  - Version in that branch becomes 0.4.0, and patch bumps (0.4.1, 0.4.2, …) are published as stable.
  - Marketplace will then show 0.4.Z as the latest stable.
- Cycle:
  - After cutting release/0.4, bump main’s package.json to 0.6.0.
  - Future prereleases are tagged as 0.5.Z.
  - This odd/even cadence repeats for each new cycle.

## Contributing

Please read our [Contributing Guide](https://github.com/konveyor/community/blob/main/CONTRIBUTING.md) before submitting a pull request.

## Code of Conduct

This project follows the Konveyor [Code of Conduct](https://github.com/konveyor/community/blob/main/CODE_OF_CONDUCT.md).

## License

See [LICENSE](LICENSE) file for details.
