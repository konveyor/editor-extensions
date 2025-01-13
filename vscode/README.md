# Kai VS Code Extension (`kai-vscode`)

The Konveyor AI (Kai) VSCode Extension is a powerful tool for application
modernization and migration analysis. It leverages cutting-edge AI to analyze
code, identify modernization opportunities, and assist in migrating applications
to newer platforms or architectures.

---

## Features

- **Analysis View**: Provides an overview of identified issues and modernization opportunities.
- **Resolutions View**: Displays proposed resolutions and allows easy application or dismissal of changes.
- **Customizability**: Configure analysis settings, rulesets, and incident filters.
- **Integration with Generative AI**: Utilize advanced AI-powered insights with configurable backend support.
- **Seamless Navigation**: Command palette, menus, and activity bar integration for intuitive usage.

---

## Installation

1. Install [Visual Studio Code](https://code.visualstudio.com/).
2. Search for `kai-vscode` in the Extensions Marketplace or [download it directly from GitHub Releases](https://github.com/konveyor/editor-extensions/releases).
3. Follow the setup walkthrough to configure your environment. Alternatively, Command Palette, select "Welcome: Open Walkthrough", and select "Konveyor".

---

## Getting Started

### Configure Generative AI Key

Set up your AI backend by providing a Generative AI Key:

1. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`).
2. Run `Konveyor: Configure GenAI Key`.

### Run an Analysis

1. Start the server: `Konveyor: Start Server` and `Konveyor: Run Analysis`.
2. Run an analysis on your code: `Konveyor: Run Analysis`.
3. Open the Analysis View to view issues: `Konveyor: Open Konveyor Analysis View`.

### Get Solutions

1. Find an violation or incident you would like to use Generative AI to fix.
2. Run "Get Solution".
3. View the proposed changes and accept/reject/modify them.

---

## Configuration Options

Customize your setup through the VS Code settings:

| Setting                           | Description                                  | Default          |
| --------------------------------- | -------------------------------------------- | ---------------- |
| `konveyor.analyzerPath`           | Path to a custom analyzer binary.            | Bundled Analyzer |
| `konveyor.logLevel`               | Log level for the extension (`debug`, etc.). | `debug`          |
| `konveyor.analysis.incidentLimit` | Max number of incidents reported.            | `10000`          |
| `konveyor.analysis.customRules`   | Array of paths to custom rulesets.           | `[]`             |

---

## Commands

Access these commands via the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`):

| Command                         | Description                              |
| ------------------------------- | ---------------------------------------- |
| `Konveyor: Configure GenAI Key` | Configure your Generative AI Key.        |
| `Konveyor: Start Server`        | Start the backend server.                |
| `Konveyor: Run Analysis`        | Analyze your codebase for modernization. |
| `Konveyor: Stop Server`         | Stop the backend server.                 |

---

## Contributing

We welcome contributions! Please file issues on [GitHub](https://github.com/konveyor/editor-extensions/issues) or open a pull request.

---

## License

This extension is licensed under the [Apache License 2.0](LICENSE).
