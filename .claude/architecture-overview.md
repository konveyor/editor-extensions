# Architecture Overview

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     VSCode Extension Host                    │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────┐ │
│  │  Core Extension │  │ Language Support │  │  Webview   │ │
│  │  (@vscode/core) │  │ (Java/JS/Go)     │  │    UI      │ │
│  └────────┬────────┘  └────────┬─────────┘  └─────┬──────┘ │
│           │                    │                   │        │
│           └────────────────────┴───────────────────┘        │
│                              │                              │
│  ┌───────────────────────────┼──────────────────────────┐  │
│  │         Extension State (Immer)                      │  │
│  │  - Analysis results, Server state, Solutions, etc.  │  │
│  └──────────────────────────────────────────────────────┘  │
└──────────────────┬──────────────┬──────────────────────────┘
                   │              │
       ┌───────────┘              └───────────┐
       │                                      │
       ▼                                      ▼
┌─────────────────┐                  ┌────────────────┐
│  Kai Analyzer   │                  │  Konveyor Hub  │
│  (RPC Server)   │                  │  (REST API)    │
│                 │                  │                │
│  - Analysis     │                  │  - Profiles    │
│  - Solutions    │                  │  - LLM Proxy   │
│  - Agentic      │                  │  - Sync        │
└─────────────────┘                  └────────────────┘
```

## Component Layers

### Layer 1: Shared Foundation

**Workspace**: `@editor-extensions/shared`

- **Purpose**: Common types, interfaces, utilities
- **Consumers**: All other workspaces
- **Build**: Vite → ESM, CJS, TypeScript definitions
- **Key Exports**:
  - `ExtensionData` - Main state interface
  - `WebviewMessage` - Message types for extension ↔ webview
  - `RuleSet`, `Incident`, `ChatMessage` - Domain types
  - Utility functions

**Critical**: Must be built before other workspaces can use its types.

### Layer 2: AI Workflows

**Workspace**: `@editor-extensions/agentic`

- **Purpose**: LangChain/LangGraph AI agent system
- **Dependencies**: `@editor-extensions/shared`
- **Key Components**:
  - `KaiInteractiveWorkflow` - Main workflow orchestrator
  - Caching system (in-memory, file-based)
  - Model provider abstraction
  - Streaming response handling

### Layer 3A: Extension Backend

**Workspaces**: `@vscode/core`, `@vscode/java`, `@vscode/javascript`, `@vscode/go`

- **Purpose**: VSCode extension logic
- **Dependencies**: `@shared`, `@agentic`
- **Build**: Webpack → Single bundle
- **Key Components**:
  - `VsCodeExtension` - Main extension class
  - `AnalyzerClient` - RPC communication with kai
  - `HubConnectionManager` - Hub integration
  - `VerticalDiffManager` - Diff editor management
  - `DiagnosticTaskManager` - Agentic workflow orchestration
  - Command handlers and UI providers

### Layer 3B: Frontend UI

**Workspace**: `@editor-extensions/webview-ui`

- **Purpose**: React-based webview panels
- **Dependencies**: `@shared`, PatternFly
- **Build**: Vite → Static bundle
- **Key Components**:
  - `AnalysisPage` - Shows analysis results
  - `ResolutionsPage` - Shows AI solutions
  - `ProfileManagerPage` - Manages profiles
  - Zustand store - State management
  - Message handlers - Extension communication

### Layer 4: Testing

**Workspace**: `tests/`

- **Purpose**: E2E and integration testing
- **Framework**: Playwright
- **Test Types**:
  - Base functionality tests
  - Solution server tests
  - Analysis validation tests
  - Agent flow tests

## Data Flow

### Analysis Flow

```
User Action (Run Analysis)
    ↓
VSCode Command Handler
    ↓
Extension: Start Analyzer
    ↓
Analyzer RPC: analyze()
    ↓
Analyzer: Process codebase with rulesets
    ↓
Analyzer RPC: Return results
    ↓
Extension: Update state (Immer)
    ↓
Extension: Broadcast to webview
    ↓
Webview: Update Zustand store
    ↓
React: Re-render UI
```

### Solution Generation Flow

```
User Action (Get Solution)
    ↓
Webview: Dispatch action
    ↓
Extension: Receive action
    ↓
Extension: Initialize KaiInteractiveWorkflow
    ↓
Workflow: Call LLM (via provider)
    ↓
Workflow: Stream response chunks
    ↓
Extension: Update state incrementally
    ↓
Extension: Broadcast streaming updates
    ↓
Webview: Update chat UI
    ↓
Extension: Create diff editor
    ↓
User: Review/Apply changes
```

### Agent Mode Flow (Automated Fixes)

```
User: Enable Agent Mode
    ↓
Extension: Start DiagnosticTaskManager
    ↓
VSCode: File saved
    ↓
Analyzer: Incremental analysis
    ↓
Extension: New diagnostics found
    ↓
TaskManager: Create fix task
    ↓
Workflow: Generate solution
    ↓
TaskManager: Apply fix automatically
    ↓
VSCode: Update file
    ↓
Repeat for next diagnostic
```

## State Management

### Extension State (Backend)

Uses **Immer** for immutable updates:

```typescript
this.data = produce(this.data, (draft) => {
  draft.isAnalyzing = true;
  draft.ruleSets = newRuleSets;
});
this._onDidChange.fire(this.data);
```

**State Structure**: Matches `ExtensionData` interface from `@shared`

### Webview State (Frontend)

Uses **Zustand** for reactive state:

```typescript
const useExtensionStore = create<ExtensionData>((set) => ({
  isAnalyzing: false,
  ruleSets: [],
  // ... state and actions
}));
```

**State Sync**: Webview receives messages from extension and updates store.

## Communication Protocols

### Extension ↔ Webview (Message Passing)

**Extension → Webview**: Post messages via webview API

```typescript
webviewPanel.webview.postMessage({
  type: "ANALYSIS_STATE_UPDATE",
  ruleSets: [...],
  timestamp: "..."
});
```

**Webview → Extension**: VS Code API

```typescript
vscode.postMessage({
  type: "RUN_ANALYSIS",
  payload: { profileId: "..." },
});
```

### Extension ↔ Analyzer (JSON-RPC)

**Protocol**: JSON-RPC over stdio

```typescript
// Request
connection.sendRequest("analyze", { workspace, profile });

// Notification
connection.onNotification("progress", (params) => {
  // Handle progress update
});
```

### Extension ↔ Hub (REST API)

**Protocol**: HTTPS REST API with auth

```typescript
// Fetch profiles
const profiles = await hubClient.getProfiles();

// Use LLM proxy
const response = await hubClient.chat(messages);
```

## Runtime Dependencies

### Required Binaries

- **kai analyzer** - Python binary for analysis
- **JDT Language Server** - For Java analysis
- Packaged in `downloaded_assets/`

### Required Libraries

- **Node.js** ≥22.9.0
- **npm** ≥10.5.2
- **VSCode** ≥1.93.0

### External Services (Optional)

- **Konveyor Hub** - Profile sync, LLM proxy
- **LLM Providers** - OpenAI, Bedrock, Ollama, etc.

## Build Pipeline

```
Source Files (.ts, .tsx)
    ↓
TypeScript Compiler (tsc)
    ↓
[shared/agentic] → Vite → ESM/CJS bundles
[webview-ui] → Vite → Static HTML/JS/CSS
[vscode/*] → Webpack → Single extension bundle
    ↓
Built Output (dist/, out/, build/)
    ↓
npm run dist → Structured distribution
    ↓
npm run package → .vsix files
    ↓
VSCode Installation
```

## Extension Points

### Adding New Analysis Rules

1. Add rulesets to `downloaded_assets/rulesets/`
2. Reference in analysis profile
3. Analyzer automatically loads on analysis

### Adding New LLM Provider

1. Create provider class extending `BaseModelProvider`
2. Add to `modelProvider/providers/`
3. Register in provider factory
4. Update YAML schema

### Adding New Webview Panel

1. Create React component in `webview-ui/src/components/`
2. Register webview provider in extension
3. Create VSCode command to open panel
4. Define message types in `@shared`

### Adding New Language Support

1. Create new workspace: `vscode/[language]/`
2. Implement language-specific analysis
3. Register with core extension
4. Add to build pipeline

## Performance Considerations

### State Updates

- Use granular message types (not full state broadcasts)
- Batch updates when possible
- Debounce rapid changes

### Build Performance

- Watch mode for development (`npm run dev`)
- Incremental builds (Webpack/Vite)
- Parallel workspace builds (via concurrently)

### Analysis Performance

- Incremental analysis (analyze changed files only)
- Cached LLM responses (demo mode)
- Streaming for long operations

## Security

### Sandbox Model

- Extension runs in Node.js context (privileged)
- Webview runs in sandboxed iframe (limited privileges)
- No direct file access from webview

### Credential Management

- LLM provider credentials in `~/.konveyor/llm-provider-settings.yaml`
- Hub credentials via VSCode secret storage
- Never commit credentials to git

### Code Execution

- Analyzer runs as subprocess (isolated)
- LLM responses sanitized before rendering
- User review required before applying changes

## Monitoring and Debugging

### Logging

- Winston logger in extension
- Output channel: "Konveyor"
- Configurable log levels (debug, info, warn, error)

### Tracing

- LLM interaction traces (optional)
- Stored in configured trace directory
- Includes full request/response chains

### Debugging

- VSCode debugger for extension code
- Browser DevTools for webview
- Network inspection for API calls
- Test traces via Playwright
