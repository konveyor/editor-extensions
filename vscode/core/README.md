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
- **Cluster Runs (Preview)**: Start migration workflows on Konveyor's agentic platform and pick up their results in the editor
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

## Cluster Runs (Preview)

When your Konveyor Hub has the agentic platform enabled, migration agents can
run in the cluster instead of on your machine. The Konveyor console follows
and supervises those runs; the extension starts them and brings their results
into the editor, where you finish the work.

### Requirements

- A Hub (Konveyor 0.11 or newer) with agentic enabled, connected with
  **Profile Sync** on.
- A workspace whose git remote matches an application in the Hub inventory.
  The extension finds the application by repository URL.
- For **Check Out Cluster Run Branch**, a target profile on the application's
  archetype, so analysis uses the same targets as the Hub.

### Commands

Run these from the Command Palette:

| Command                                    | Use it to                                                                                                                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Konveyor: Start Migration on Cluster**   | Start a migration workflow (such as `java-ee-to-quarkus`: plan → execute → verify) or a single agent for this application. Then open the run in the Konveyor console to follow it. |
| **Konveyor: Check Out Cluster Run Branch** | Continue a run's migration on its own branch.                                                                                                                                      |
| **Konveyor: Review Cluster Run Results**   | Bring part of a run into the branch you are on.                                                                                                                                    |

### Which way to pick up a run

A run pushes its changes to a branch (its _target branch_). There are two ways
to work with that branch in the editor:

- **Check out the branch** to continue the migration. The command checks out
  the run's branch with its commits, syncs the application's analysis profile
  from the Hub, activates it, and runs analysis. What analysis still reports is
  what is left to migrate: fix it with Get Solution or the agent, then push to
  keep the migration on the run's branch. Your working tree must be clean.
  If the application has no Hub profile, the command says so and asks before
  analyzing with your current profile, whose targets may differ from the ones
  the run used.
- **Review the results** to adopt only some of the run's changes into the
  branch you are on. The run's changed files appear in the Migration
  Assistant's review list as proposals, compared with your current files.
  Apply or reject each one, or choose **Review** to accept or reject
  individual changes in the editor. Nothing is written until you apply it.
  Files you have also changed locally are flagged: applying one replaces your
  version, so review those change by change.

A run that is still in progress can be picked up too, because the agent pushes
its changes as it works.

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

| Variable                      | Type                 | Default                 | Description                                              |
| ----------------------------- | -------------------- | ----------------------- | -------------------------------------------------------- |
| `HUB_URL`                     | string               | `http://localhost:8080` | Konveyor Hub URL                                         |
| `HUB_USERNAME`                | string               | `admin`                 | Hub authentication username                              |
| `HUB_PASSWORD`                | string               | _(empty)_               | Hub authentication password                              |
| `FORCE_HUB_ENABLED`           | `"true"` flag        | `false`                 | Force-enable Hub connection regardless of other settings |
| `HUB_INSECURE`                | `"true"` flag        | `false`                 | Skip TLS verification for Hub connections                |
| `HUB_SOLUTION_SERVER_ENABLED` | `"false"` to disable | `true`                  | Toggle the Solution Server feature                       |
| `HUB_PROFILE_SYNC_ENABLED`    | `"false"` to disable | `true`                  | Toggle profile synchronization with Hub                  |

Setting `HUB_URL` or any authentication variable (`HUB_USERNAME` /
`HUB_PASSWORD`) automatically enables the Hub connection. Setting either
`HUB_USERNAME` or `HUB_PASSWORD` also enables authentication.

#### Analyzer Binary Download

| Variable                     | Type         | Default              | Description                                                                                    |
| ---------------------------- | ------------ | -------------------- | ---------------------------------------------------------------------------------------------- |
| `ANALYZER_FALLBACK_BASE_URL` | string (URL) | Built-in release URL | Override the base URL for downloading the analyzer binary (for air-gapped or internal mirrors) |

Trailing slashes are normalized automatically. This is useful in
network-restricted environments where artifacts are hosted on an internal
mirror.

#### TLS and Certificates

| Variable                       | Type               | Description                                                                       |
| ------------------------------ | ------------------ | --------------------------------------------------------------------------------- |
| `CA_BUNDLE`                    | string (file path) | Path to a custom CA certificate bundle                                            |
| `AWS_CA_BUNDLE`                | string (file path) | Fallback CA bundle path (used when `CA_BUNDLE` is not set)                        |
| `ALLOW_INSECURE`               | `"true"` or `"1"`  | Allow insecure TLS connections to model providers                                 |
| `NODE_TLS_REJECT_UNAUTHORIZED` | `"0"` to disable   | Standard Node.js TLS verification override (lower priority than `ALLOW_INSECURE`) |

#### Proxy

Standard proxy environment variables are supported. The resolution order is
`HTTPS_PROXY` > `https_proxy` > `HTTP_PROXY` > `http_proxy`.

| Variable                      | Type                     | Description                                                                    |
| ----------------------------- | ------------------------ | ------------------------------------------------------------------------------ |
| `HTTPS_PROXY` / `https_proxy` | string (URL)             | HTTPS proxy URL                                                                |
| `HTTP_PROXY` / `http_proxy`   | string (URL)             | HTTP proxy URL                                                                 |
| `NO_PROXY` / `no_proxy`       | string (comma-separated) | Hosts to bypass the proxy (supports domain suffixes and port-specific entries) |

`NO_PROXY` and `no_proxy` are combined, so a host listed in either one bypasses
the proxy.

For model provider connections these may also be set in the `environment:`
block of `provider-settings.yaml`:

```yaml
environment:
  no_proxy: "model.internal.example.com"
  # or, to bypass the proxy entirely for provider traffic:
  # https_proxy: ""
  # http_proxy: ""
```

Provider settings take precedence as a unit. If the block defines **any** proxy
variable, the inherited process values are not consulted at all — including
when the value is an empty string, which is how you disable the proxy for
provider traffic. Casing does not matter for precedence: a lowercase
`https_proxy` in the block still overrides an inherited uppercase
`HTTPS_PROXY`.

Proxy settings that come from `provider-settings.yaml` apply **only** to model
provider requests. Global routing is always derived from the process
environment, so Hub authentication and token refresh keep their inherited
proxy behavior in both directions: pointing the model at a different proxy
does not repoint the Hub, and disabling the model's proxy does not disable the
Hub's. Process-level `NO_PROXY` is evaluated per destination, so a bypass
entry for the Hub is honored even while other traffic is proxied.

> **Known limitation.** Provider proxy overrides are applied to the HTTP client
> the extension injects into each model SDK. A provider SDK that calls
> `globalThis.fetch` directly instead of the injected client — the Google
> GenAI SDK does this — will use the process-level proxy configuration rather
> than the override. If you need a provider-specific proxy for such a model,
> set it in the process environment instead.

If a provider connection is unexpectedly routed through a proxy, the
`Provider TLS config` entry in the extension log reports the resolved
`proxyUrl`, `noProxy`, `proxySource`, and `targetUrl` values used for the
decision.

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
