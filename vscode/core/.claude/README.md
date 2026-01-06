# @vscode/core (Konveyor Core Extension)

## Purpose

Main VSCode extension providing migration analysis and AI-assisted code modernization.

## Tech Stack

- **TypeScript** - Language
- **Webpack** - Bundler
- **VSCode Extension API** - Platform
- **Immer** - Immutable state updates
- **Winston** - Logging
- **LangChain** - AI/LLM integration
- **vscode-jsonrpc** - RPC communication

## Dependencies

**Requires**:

- `@editor-extensions/shared` (built)
- `@editor-extensions/agentic` (built)

## Development

**Watch mode**:

```bash
npm run dev -w vscode/core
# Or from root:
npm run dev
```

**Build**:

```bash
npm run build -w vscode/core
```

**Debug**: Press F5 in VSCode to launch Extension Development Host

## Architecture

### Main Extension Class

**File**: `src/extension.ts`

```typescript
class VsCodeExtension {
  // Immutable state
  private data: Immutable<ExtensionData>;

  // Key managers
  analyzerClient: AnalyzerClient; // RPC to kai analyzer
  workflow: KaiInteractiveWorkflow; // AI workflows
  hubConnectionManager: HubConnectionManager; // Hub integration
  diffManager: VerticalDiffManager; // Diff editors
  diagnosticTaskManager: DiagnosticTaskManager; // Agent mode
}
```

### State Management (Immer)

**Always use Immer** for state updates:

```typescript
import { produce } from "immer";

this.data = produce(this.data, (draft) => {
  draft.isAnalyzing = true;
  draft.analysisProgress = 50;
  draft.ruleSets = newRuleSets;
});

// Notify listeners (webviews, etc.)
this._onDidChange.fire(this.data);
```

**Never** mutate state directly!

## Key Components

### AnalyzerClient

**Location**: `src/client/analyzerClient.ts`

Manages kai analyzer RPC server:

```typescript
// Start server
await analyzerClient.start();

// Call RPC method
const result = await analyzerClient.connection.sendRequest("analyze", { workspace, profile });

// Handle notifications
analyzerClient.connection.onNotification("progress", (params) => {
  this.updateProgress(params);
});
```

### KaiInteractiveWorkflow

**From**: `@editor-extensions/agentic`

AI solution generation:

```typescript
import { KaiInteractiveWorkflow } from "@editor-extensions/agentic";

const workflow = new KaiInteractiveWorkflow({
  modelProvider: this.modelProvider,
  cache: this.cache,
  // ...
});

// Generate solution (streaming)
for await (const chunk of workflow.run(incident, context)) {
  this.broadcastChatChunk(chunk);
}
```

### HubConnectionManager

**Location**: `src/hub/`

Manages Konveyor Hub:

- Profile synchronization
- LLM proxy access
- Authentication

### Commands

**Location**: `src/commands/`

All extension commands:

- `konveyor.runAnalysis` - Start analysis
- `konveyor.startServer` / `stopServer` - Manage server
- `konveyor.fixIncident` - Get AI solution
- `konveyor.showAnalysisPanel` - Open analysis view
- And many more...

**Adding a command**:

1. Define in `package.json` → `contributes.commands`
2. Implement handler in `src/commands/myCommand.ts`
3. Register in `src/commands/index.ts`

## Webview Communication

### Sending to Webview

**Granular updates** (efficient):

```typescript
webview.postMessage({
  type: "ANALYSIS_STATE_UPDATE",
  ruleSets: this.data.ruleSets,
  isAnalyzing: this.data.isAnalyzing,
  timestamp: new Date().toISOString(),
});
```

**Full state** (initial load):

```typescript
webview.postMessage(this.data);
```

### Receiving from Webview

```typescript
webview.onDidReceiveMessage((message) => {
  switch (message.type) {
    case "RUN_ANALYSIS":
      await this.runAnalysis(message.payload);
      break;
    case "GET_SOLUTION":
      await this.getSolution(message.payload);
      break;
  }
});
```

## Configuration

**Settings** defined in `package.json` → `contributes.configuration`

**Reading config**:

```typescript
import * as vscode from "vscode";

const config = vscode.workspace.getConfiguration("konveyor");
const logLevel = config.get<string>("logLevel", "debug");
const agentMode = config.get<boolean>("genai.agentMode", false);
```

**Key settings**:

- `konveyor.logLevel` - Logging verbosity
- `konveyor.genai.enabled` - Enable AI features
- `konveyor.genai.agentMode` - Automated fixes
- `konveyor.analysis.analyzeOnSave` - Auto-analyze on save

## Model Providers

**Location**: `src/modelProvider/`

Supports multiple LLM providers:

- OpenAI (and compatible APIs)
- AWS Bedrock
- Google Gemini
- Ollama (local)
- DeepSeek
- Azure OpenAI

**Config**: `~/.konveyor/llm-provider-settings.yaml`

**Usage**:

```typescript
import { getModelProviderFromConfig } from "./modelProvider";

const provider = await getModelProviderFromConfig(settingsPath);
const llm = provider.getChatModel(); // LangChain ChatModel
```

## Logging

**Winston** with VSCode output channel:

```typescript
import winston from "winston";

// Log at various levels
logger.info("Starting analysis");
logger.debug("Analysis config", { config });
logger.error("Failed to connect", { error });
```

**View logs**: View → Output → Konveyor

## Asset Management

**Location**: `src/paths.ts`

Required runtime assets:

- `kai` analyzer binary
- JDT Language Server
- Rulesets
- FernFlower (Java decompiler)

Downloaded via:

```bash
npm run collect-assets:dev
```

## Common Patterns

### Update State & Broadcast

```typescript
updateAnalysisState(results: RuleSet[]) {
  this.data = produce(this.data, (draft) => {
    draft.ruleSets = results;
    draft.isAnalyzing = false;
  });

  // Broadcast to webview
  this.broadcastAnalysisUpdate();
}
```

### Call RPC Method

```typescript
const result = await this.analyzerClient.connection.sendRequest("method_name", { param1, param2 });
```

### Show User Notification

```typescript
vscode.window.showInformationMessage("Analysis complete!");
vscode.window.showErrorMessage("Analysis failed", { detail: error });
```

## Testing

```bash
npm run test:unit-tests -w vscode/core
npm run test:integration -w vscode/core
```

## Build Output

Webpack bundles to:

- `out/extension.js` - Main bundle
- `out/` - Other resources

## Debugging

1. Set breakpoints in `.ts` files
2. Press **F5** to start Extension Development Host
3. Trigger code path in new window
4. Check **Debug Console** for output
5. Check **Output panel** (View → Output → Konveyor)
