# Konveyor VSCode Extension

A powerful VS Code extension for application modernization and migration
analysis. Leverages a rule-based analysis engine to identify modernization
opportunities and optionally uses generative AI to help migrate applications
to newer platforms or architectures.

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

### 1. Create Analysis Profile

- Configure analysis settings and rules
- Set up your analysis scope and targets

### 2. Run Analysis

- Start the server
- Run analysis on your code
- View results in the panel

### 3. Configure AI (Optional)

To enable AI-powered solution generation, enable AI features and configure your AI provider through the extension settings.

### 4. Generate Solutions

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

### Environment Variables

The extension supports environment variables for pre-configuring behavior in
managed environments such as Dev Spaces where an "out-of-the-box" configuration
is desired. Environment variable overrides take precedence over saved VS Code
settings.

#### Hub Configuration

These variables configure the connection to a Konveyor Hub instance. They are
read at initialization and overlaid on top of any persisted VS Code
configuration.

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `HUB_URL` | string | `http://localhost:8080` | Konveyor Hub URL |
| `HUB_USERNAME` | string | `admin` | Hub authentication username |
| `HUB_PASSWORD` | string | _(empty)_ | Hub authentication password |
| `FORCE_HUB_ENABLED` | `"true"` flag | `false` | Force-enable Hub connection regardless of other settings |
| `HUB_INSECURE` | `"true"` flag | `false` | Skip TLS verification for Hub connections |
| `HUB_SOLUTION_SERVER_ENABLED` | `"false"` to disable | `true` | Toggle the Solution Server feature |
| `HUB_PROFILE_SYNC_ENABLED` | `"false"` to disable | `true` | Toggle profile synchronization with Hub |

Setting `HUB_URL` or any authentication variable (`HUB_USERNAME` /
`HUB_PASSWORD`) automatically enables the Hub connection. Setting either
`HUB_USERNAME` or `HUB_PASSWORD` also enables authentication.

#### Analyzer Binary Download

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `ANALYZER_FALLBACK_BASE_URL` | string (URL) | Built-in release URL | Override the base URL for downloading the analyzer binary (for air-gapped or internal mirrors) |

Trailing slashes are normalized automatically. This is useful in
network-restricted environments where artifacts are hosted on an internal
mirror.

#### TLS and Certificates

| Variable | Type | Description |
| --- | --- | --- |
| `CA_BUNDLE` | string (file path) | Path to a custom CA certificate bundle |
| `AWS_CA_BUNDLE` | string (file path) | Fallback CA bundle path (used when `CA_BUNDLE` is not set) |
| `ALLOW_INSECURE` | `"true"` or `"1"` | Allow insecure TLS connections to model providers |
| `NODE_TLS_REJECT_UNAUTHORIZED` | `"0"` to disable | Standard Node.js TLS verification override (lower priority than `ALLOW_INSECURE`) |

#### Proxy

Standard proxy environment variables are supported. The resolution order is
`HTTPS_PROXY` > `https_proxy` > `HTTP_PROXY` > `http_proxy`.

| Variable | Type | Description |
| --- | --- | --- |
| `HTTPS_PROXY` / `https_proxy` | string (URL) | HTTPS proxy URL |
| `HTTP_PROXY` / `http_proxy` | string (URL) | HTTP proxy URL |
| `NO_PROXY` / `no_proxy` | string (comma-separated) | Hosts to bypass the proxy (supports wildcards, domain suffixes, and port-specific entries) |

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
