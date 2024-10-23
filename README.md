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

### Running the Extension in Development Mode

Once you've installed all dependencies, you can run the extension in development mode by following these steps:

Press the F5 key inside Visual Studio Code to open a new Extension Development Host window.

This command performs the following actions:

- Compiles the extension source code using Webpack
- Starts the Vite dev server for the webview UI
- Runs Webpack in watch mode to automatically rebuild the extension on file changes

Note: The extension will not be visible in the Extension Development Host window until you open the Konveyor UI.

Inside the Extension Development Host window, press Ctrl+Shift+P (or Cmd+Shift+P on Mac) to open the Command Palette and type View: Show Konveyor to open the Konveyor UI within the host.

### Watch Mode

If you want to run the extension in watch mode separately:

Use the following npm command to run the extension and webview UI in watch mode:

```bash
npm run dev
```

This command:

- Starts Vite for the webview UI
- Runs Webpack for the extension in watch mode to track changes and recompile

### Building the Extension

To build the extension, run the following command:

```bash
npm run build
```

This command:

- Compiles the extension source code using Webpack
- Bundles the webview UI using Vite

The build output is placed in the out directory.
Note: Webpack copy plugin is used to copy the webview UI assets to the out directory.

## Project Structure

```
├── vscode/            # The main VS Code extension source code
│   ├── src/           # Extension source files
│   ├── webpack.config.js # Webpack configuration for bundling the extension
│   └── node_modules/   # Dependencies for the extension
│
├── webview-ui/        # Webview UI source code for the extension
│   ├── src/           # React components and logic for the webview UI
│   ├── vite.config.ts # Vite configuration for bundling the webview UI
│   └── node_modules/  # Dependencies for the webview UI
│
└── package.json       # Main package configuration and scripts
```

## Available npm Scripts

The following npm scripts are available:

- `npm run dev`: Runs the extension and webview UI in watch mode with live reloading
- `npm run build`: Builds both the extension and the webview UI for production
- `npm run test`: Runs unit tests for the extension

## Contributing

Please read our [Contributing Guide](https://github.com/konveyor/community/blob/main/CONTRIBUTING.md) before submitting a pull request.

## Code of Conduct

This project follows the Konveyor [Code of Conduct](https://github.com/konveyor/community/blob/main/CODE_OF_CONDUCT.md).

## License

See [LICENSE](LICENSE.md) file for details.
