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

- [Node.js](https://nodejs.org/) (LTS version recommended)
- [npm](https://www.npmjs.com/)
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
   ```bash
   npm run collect-assets
   ```

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

Non project folders:

- [`docs`](./docs/) <br>
  Project documentation, roadmaps and wireframes.

- [`scripts`](./scripts/) <br>
  Javascript scripts used to setup the environment, build, and package the project.

## Contributing

Please read our [Contributing Guide](https://github.com/konveyor/community/blob/main/CONTRIBUTING.md) before submitting a pull request.

## Code of Conduct

This project follows the Konveyor [Code of Conduct](https://github.com/konveyor/community/blob/main/CODE_OF_CONDUCT.md).

## License

See [LICENSE](LICENSE) file for details.
