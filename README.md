# Build and Test Status

| branch | last merge CI                                                                                                                                                                                                   | nightly CI                                                                                                                                                                                                                                    |
| :----- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| main   | [![CI (repo level)](https://github.com/konveyor/editor-extensions/actions/workflows/ci-repo.yml/badge.svg?branch=main&event=push)](https://github.com/konveyor/editor-extensions/actions/workflows/ci-repo.yml) | [![Nightly CI (repo level)](https://github.com/konveyor/editor-extensions/actions/workflows/nightly-ci-repo.yaml/badge.svg?branch=main&event=schedule)](https://github.com/konveyor/editor-extensions/actions/workflows/nightly-ci-repo.yaml) |

# Konveyor Editor Extensions

This repository contains the assets and source code for editor extensions.

## Usage

[Brief guide on how to use the extension's main features]

## Developing & Running the extension

```bash
    # Install dependencies for both the extension and webview UI source code
    npm install

    # Compile the extension source code
    # Start the vite dev server for the webview UI
    # Start the webpack dev server for extension in watch mode

    npm run dev

```

Once the project is open inside VS Code, you can run the extension by doing the following:

1. Press `F5` to open a new Extension Development Host window.

2. Inside the host window, open the command palette (`Ctrl+Shift+P` or `Cmd+Shift+P` on Mac) and type `View: Show Konveyor`

## License

See the [LICENSE](LICENSE.md) file for details.

## Contributing

See [Contributing Guide](https://github.com/konveyor/community/blob/main/CONTRIBUTING.md) for details.

## Code of Conduct

Refer to our [Code of Conduct page](https://github.com/konveyor/community/blob/main/CODE_OF_CONDUCT.md) for detailed information.
