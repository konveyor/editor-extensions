# Konveyor VSCode Extension

A powerful VS Code extension for application modernization and migration
analysis. Leverages rules based analysis engine to analyze code, identify
modernization opportunities, and optionally use generative AI in migrating
applications to newer platforms or architectures.

---

## Features

- **Code Analysis**: Comprehensive analysis of your codebase for modernization opportunities
- **AI-Powered Solutions**: Optional generative AI integration for automated fix suggestions
- **Agent Mode**: Experimental automated fixes with diagnostics integration
- **Customizable Rules**: Configure analysis settings, rulesets, and filters
- **Interactive UI**: Dedicated views for analysis results and solution management

---

## Quick Start

1. Install the extension from the VS Code marketplace
2. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run "Welcome: Open Walkthrough"
3. Follow the setup guide to configure your environment

---

## Basic Workflow

### 1. Configure AI (Optional)

Configure your AI provider for solution generation through the extension settings.

### 2. Run Analysis

- Start the analysis server
- Run analysis on your code
- View results in the analysis panel

### 3. Apply Solutions

- Select issues you want to fix
- Generate AI solutions or apply manual fixes
- Review and accept/reject proposed changes

---

## Configuration

The extension can be configured through VS Code settings. Key settings include:

- **Log Level**: Control extension logging verbosity
- **Analyzer Path**: Use custom analyzer binary
- **GenAI Settings**: Configure AI provider and behavior
- **Analysis Options**: Customize analysis scope and rules

## Path Exclusion

The extension supports `.gitignore`-style exclusion patterns:

1. Create an ignore file in your workspace root
2. Use standard gitignore syntax to exclude files/directories
3. Falls back to `.gitignore` if no custom ignore file exists

---

## Requirements

- **Java Projects**: Requires Red Hat Java extension for Java analysis
- **AI Features**: Optional - configure AI provider for solution generation

---

## Troubleshooting

### Logs

Access extension logs through:

- **Command Palette**: "Show Extension Logs Directory"
- **Output Panel**: Select the extension from the dropdown

### Common Issues

- Ensure required language extensions are installed
- Check that analysis server starts successfully
- Verify AI provider configuration if using solution generation

---

## License

This extension is licensed under the [Apache License 2.0](LICENSE).
