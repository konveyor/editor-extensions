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

Set up your AI backend by providing a Generative AI configurations:

1. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`).
2. Run `Konveyor: Open the GenAI model provider configuration file`.

### Run an Analysis

1. Start the server: `Konveyor: Start Server` and `Konveyor: Run Analysis`.
2. Run an analysis on your code: `Konveyor: Run Analysis`.
3. Open the Analysis View to view issues: `Konveyor: Open Konveyor Analysis View`.

### Get Solutions

1. Find an violation or incident you would like to use Generative AI to fix.
2. Run "Get Solution".
3. View the proposed changes and accept/reject/modify them.

---

## Excluding paths from analysis

The extension can be configured to ignore certain files and paths when performing analysis
and report issues.

Path exclusion configuration follow this priority ordering:

1. The extension will look for `.konveyorignore` files first. They are expected to follow the
   [standard `.gitignore` syntax](http://git-scm.com/docs/gitignore). If any `.konveyorignore`
   files are found in the workspace, they will be used.

2. If no `.konveyorignore` files are found, any found `.gitignore` files will be used.

3. If neither are found, a default set of ignores will be used. (`.vscode/`, `target/`, `.git/`,
   and `node_modules/`).

Due to some restrictions in underlying technology, exclusions apply to directories only. While
the [gitignore syntax](http://git-scm.com/docs/gitignore) allows for individual file exclusions.
Only directory exclusion will be applied. This may cause some individual files to be included
if they're named directly.

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

| Command                                                      | Description                              |
| ------------------------------------------------------------ | ---------------------------------------- |
| `Konveyor: Open the GenAI model provider configuration file` | Configure your Generative AI.            |
| `Konveyor: Start Server`                                     | Start the backend server.                |
| `Konveyor: Run Analysis`                                     | Analyze your codebase for modernization. |
| `Konveyor: Stop Server`                                      | Stop the backend server.                 |

---

## Troubleshooting

### Accessing Extension Logs

The Konveyor extension generates detailed logs to help diagnose issues:

1. **Via Command Palette**: Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`) and run `Show Extension Logs Directory`, then navigate to the `konveyor.konveyor-ai` folder.

2. **Via Output Panel**: View real-time logs in VS Code's Output panel by selecting "Konveyor" from the dropdown.

3. **Log Files**:
   - Extension logs are stored as `extension.log` with automatic rotation (10MB max size, 3 files retained).
   - Analyzer RPC logs are stored as `analyzer.log` without rotation.

**Note**: Logs are no longer stored in the workspace `.vscode` directory. They now use VS Code's standard extension logging location.

---

## Contributing

We welcome contributions! Please file issues on [GitHub](https://github.com/konveyor/editor-extensions/issues) or open a pull request.

---

## License

This extension is licensed under the [Apache License 2.0](LICENSE).
