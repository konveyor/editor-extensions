# VSCode Extension Architecture

## Extension Structure

The VSCode extension is split into multiple language-specific extensions:

- `@vscode/core` - Main extension (required)
- `@vscode/java` - Java language support
- `@vscode/javascript` - JavaScript language support
- `@vscode/go` - Go language support

All extensions follow the same architectural patterns.

## Core Technologies

- **TypeScript** - Programming language
- **Webpack** - Build bundler
- **Winston** - Logging
- **Immer** - Immutable state updates
- **LangChain** - AI/LLM integration
- **vscode-jsonrpc** - RPC communication with analyzers

## Main Extension Class

**File**: `vscode/core/src/extension.ts`

The `VsCodeExtension` class is the heart of the extension:

```typescript
class VsCodeExtension {
  public state: ExtensionState;
  private data: Immutable<ExtensionData>;
  private _onDidChange = new vscode.EventEmitter<Immutable<ExtensionData>>();
  readonly onDidChangeData = this._onDidChange.event;

  // Key managers
  analyzerClient: AnalyzerClient;
  workflow: KaiInteractiveWorkflow;
  hubConnectionManager: HubConnectionManager;
  diffManager: VerticalDiffManager;
  issuesModel: IssuesModel;
  diagnosticTaskManager: DiagnosticTaskManager;
}
```

### State Management

The extension uses **Immer** for immutable state updates:

```typescript
import { produce } from "immer";

// Update state immutably
this.data = produce(this.data, (draft) => {
  draft.isAnalyzing = true;
  draft.analysisProgress = 50;
});

// Notify listeners of changes
this._onDidChange.fire(this.data);
```

This pattern ensures:

- State updates are atomic
- No accidental mutations
- Easy debugging of state changes

### Key Components

#### AnalyzerClient

- Manages the kai analyzer RPC server
- Starts/stops the server process
- Handles JSON-RPC communication
- Located in `vscode/core/src/client/analyzerClient.ts`

#### KaiInteractiveWorkflow

- AI agent workflow system from `@editor-extensions/agentic`
- Uses LangChain/LangGraph for solution generation
- Handles streaming responses
- Manages caching and tracing

#### HubConnectionManager

- Manages connection to Konveyor Hub
- Syncs analysis profiles
- Provides LLM proxy access
- Located in `vscode/core/src/hub/`

#### VerticalDiffManager

- Manages diff editors for code changes
- Shows proposed vs current code
- Located in `vscode/core/src/diff/vertical/manager.ts`

#### DiagnosticTaskManager

- Manages agentic workflow tasks
- Integrates with VSCode diagnostics
- Automatically fixes issues in agent mode
- Located in `vscode/core/src/taskManager/taskManager.ts`

## Communication Patterns

### Extension ↔ Webview

The extension communicates with webview panels using granular message types:

**Sending to webview**:

```typescript
// Send specific state update (efficient)
webviewPanel.webview.postMessage({
  type: "ANALYSIS_STATE_UPDATE",
  ruleSets: this.data.ruleSets,
  enhancedIncidents: this.data.enhancedIncidents,
  isAnalyzing: this.data.isAnalyzing,
  timestamp: new Date().toISOString(),
});

// Or send full state (initial load)
webviewPanel.webview.postMessage(this.data);
```

**Receiving from webview**:

```typescript
webviewPanel.webview.onDidReceiveMessage(
  (message) => {
    switch (message.type) {
      case "START_ANALYSIS":
        this.handleStartAnalysis();
        break;
      case "GET_SOLUTION":
        this.handleGetSolution(message.payload);
        break;
    }
  },
  undefined,
  context.subscriptions,
);
```

### Extension ↔ Analyzer (RPC)

The extension uses JSON-RPC to communicate with the kai analyzer:

```typescript
import { MessageConnection } from "vscode-jsonrpc/node";

// Call RPC method
const result = await this.connection.sendRequest("analyze", {
  workspace: workspacePath,
  profile: profileConfig,
});

// Listen for notifications
this.connection.onNotification("progress", (params) => {
  this.updateProgress(params.percentage, params.message);
});
```

## Extension Activation

**File**: `vscode/core/src/extension.ts`

The extension activates when:

- VSCode starts (if previously active)
- User opens the Konveyor panel
- Custom file systems are accessed

```typescript
export async function activate(context: vscode.ExtensionContext) {
  // Initialize logging
  const logger = createLogger();

  // Ensure paths and assets exist
  await ensurePaths();
  await ensureKaiAnalyzerBinary();

  // Create extension instance
  const extension = new VsCodeExtension(paths, context, logger, registry);

  // Register commands
  registerAllCommands(context, extension);

  // Register UI components
  registerIssueView(context, extension);

  // Initialize state
  await extension.initialize();
}
```

## Asset Management

The extension requires runtime assets:

- **kai analyzer** - Python binary for analysis
- **JDT Language Server** - Java analysis
- **Rulesets** - Migration rules
- **FernFlower** - Java decompiler

Assets are:

1. Downloaded via `npm run collect-assets` or `npm run collect-assets:dev`
2. Stored in `downloaded_assets/`
3. Copied to `dist/` during packaging
4. Referenced in `package.json` under `includedAssetPaths`

**Asset paths** (defined in `vscode/core/src/paths.ts`):

```typescript
export const paths = {
  kaiAnalyzerBinary: "downloaded_assets/kai/kai",
  jdtls: "downloaded_assets/jdt.ls-1.38.0",
  rulesets: "downloaded_assets/rulesets",
  // ...
};
```

## Configuration

Extension settings are defined in `vscode/core/package.json` under `contributes.configuration`:

```json
{
  "konveyor.logLevel": "debug",
  "konveyor.analyzerPath": "",
  "konveyor.genai.enabled": true,
  "konveyor.genai.agentMode": false,
  "konveyor.analysis.analyzeOnSave": true
}
```

**Reading configuration**:

```typescript
import * as vscode from "vscode";

const config = vscode.workspace.getConfiguration("konveyor");
const logLevel = config.get<string>("logLevel", "debug");
const agentMode = config.get<boolean>("genai.agentMode", false);
```

## Model Provider System

The extension supports multiple LLM providers via a plugin system:

**File**: `vscode/core/src/modelProvider/`

Supported providers:

- OpenAI (and compatible APIs)
- AWS Bedrock
- Google Gemini
- Ollama (local)
- DeepSeek
- Azure OpenAI

**Configuration**: `~/.konveyor/llm-provider-settings.yaml`

**Usage**:

```typescript
import { getModelProviderFromConfig } from "./modelProvider";

const provider = await getModelProviderFromConfig(settingsPath);
const llm = provider.getChatModel(); // Returns LangChain ChatModel
```

## Logging

The extension uses Winston with a custom VSCode output channel transport:

```typescript
import winston from "winston";
import { OutputChannelTransport } from "winston-transport-vscode";

const logger = winston.createLogger({
  level: getConfigLogLevel(),
  transports: [
    new OutputChannelTransport({
      outputChannel: vscode.window.createOutputChannel("Konveyor"),
    }),
  ],
});

logger.info("Starting analysis");
logger.error("Failed to connect", { error });
```

## Commands

All commands are registered in `vscode/core/src/commands/`:

Key commands:

- `konveyor.runAnalysis` - Start analysis
- `konveyor.startServer` / `konveyor.stopServer` - Manage server
- `konveyor.fixIncident` - Get AI solution for incident
- `konveyor.showAnalysisPanel` - Open analysis webview
- `konveyor.showResolutionPanel` - Open solution webview

**Command registration**:

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand("konveyor.runAnalysis", async () => {
    await extension.runAnalysis();
  }),
);
```

## Testing

Extension tests use:

- **Mocha** - Test framework
- **@vscode/test-electron** - VSCode test runner
- **cross-env** - Environment variables

```bash
npm run test:unit-tests -w vscode/core
npm run test:integration -w vscode/core
```

## Build Configuration

**File**: `vscode/core/webpack.config.js`

Webpack bundles the extension for distribution:

- Entry: `src/extension.ts`
- Output: `out/extension.js`
- Target: `node` (VSCode extension host)
- Externals: `vscode` module
- Mode: `production` for builds, `development` for watch

```bash
npm run build -w vscode/core   # Production build
npm run dev -w vscode/core     # Development watch mode
```
