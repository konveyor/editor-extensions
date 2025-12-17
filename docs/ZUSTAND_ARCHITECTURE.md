# Zustand Architecture: Full Picture

This document explains how the VSCode extension's vanilla Zustand store (Node.js) communicates with the webview's React Zustand store (Browser).

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     VSCODE EXTENSION HOST (Node.js)                 │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │              Vanilla Zustand Store                         │   │
│  │            (extensionStore.ts)                             │   │
│  │                                                            │   │
│  │  State Properties:                                         │   │
│  │    • profilesList: AnalysisProfile[]                       │   │
│  │    • ruleSets: RuleSet[]                                   │   │
│  │    • isAnalyzing: boolean                                  │   │
│  │    • serverState: ServerState                              │   │
│  │    • chatMessages: ChatMessage[]                           │   │
│  │    • ... (all extension state)                             │   │
│  │                                                            │   │
│  │  Domain Actions:                                           │   │
│  │    ├─ hub.applyConfigurationFromUI(config)                 │   │
│  │    ├─ hub.profileSync.begin()                              │   │
│  │    ├─ hub.solutionServer.markConnected()                   │   │
│  │    ├─ analysis.begin()                                     │   │
│  │    ├─ analysis.complete(results)                           │   │
│  │    ├─ profiles.load(profiles, activeId)                    │   │
│  │    ├─ profiles.add(profile)                                │   │
│  │    ├─ server.markRunning()                                 │   │
│  │    └─ ... (business-focused actions)                       │   │
│  │                                                            │   │
│  └────────────────┬───────────────────────────────────────────┘   │
│                   │                                               │
│                   │ State changes trigger subscriptions           │
│                   ▼                                               │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │              Sync Bridge Manager                           │   │
│  │            (syncBridge.ts)                                 │   │
│  │                                                            │   │
│  │  Using: subscribeWithSelector middleware                   │   │
│  │                                                            │   │
│  │  Bridges (declared in initializeSyncBridges.ts):          │   │
│  │                                                            │   │
│  │  ┌──────────────────────────────────────────────────┐     │   │
│  │  │ Bridge 1: Analysis State                         │     │   │
│  │  │  Selector: state => ({                           │     │   │
│  │  │    ruleSets, enhancedIncidents, isAnalyzing,     │     │   │
│  │  │    analysisProgress, ...                         │     │   │
│  │  │  })                                              │     │   │
│  │  │  Message: "ANALYSIS_STATE_UPDATE"                │     │   │
│  │  │  Equality: shallow                               │     │   │
│  │  └──────────────────────────────────────────────────┘     │   │
│  │                                                            │   │
│  │  ┌──────────────────────────────────────────────────┐     │   │
│  │  │ Bridge 2: Profiles                               │     │   │
│  │  │  Selector: state => ({                           │     │   │
│  │  │    profiles: state.profilesList,                 │     │   │
│  │  │    activeProfileId, isInTreeMode                 │     │   │
│  │  │  })                                              │     │   │
│  │  │  Message: "PROFILES_UPDATE"                      │     │   │
│  │  │  Equality: shallow                               │     │   │
│  │  └──────────────────────────────────────────────────┘     │   │
│  │                                                            │   │
│  │  ┌──────────────────────────────────────────────────┐     │   │
│  │  │ Bridge 3: Server State                           │     │   │
│  │  │  Selector: state => ({                           │     │   │
│  │  │    serverState, isStartingServer,                │     │   │
│  │  │    solutionServerConnected, ...                  │     │   │
│  │  │  })                                              │     │   │
│  │  │  Message: "SERVER_STATE_UPDATE"                  │     │   │
│  │  │  Equality: reference (default)                   │     │   │
│  │  └──────────────────────────────────────────────────┘     │   │
│  │                                                            │   │
│  │  ... (9+ bridges total)                                   │   │
│  │                                                            │   │
│  └────────────────┬───────────────────────────────────────────┘   │
│                   │                                               │
│                   │ When state changes:                           │
│                   │ 1. Run selector                               │
│                   │ 2. Check equality (prevent duplicates)        │
│                   │ 3. Broadcast to webviews                      │
│                   ▼                                               │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │         Webview Providers                                  │   │
│  │   (KonveyorGUIWebviewViewProvider)                         │   │
│  │                                                            │   │
│  │   provider.sendMessageToWebview({                          │   │
│  │     type: "PROFILES_UPDATE",                               │   │
│  │     profiles: [...],                                       │   │
│  │     activeProfileId: "123",                                │   │
│  │     isInTreeMode: true,                                    │   │
│  │     timestamp: "2024-01-01T00:00:00Z"                      │   │
│  │   })                                                       │   │
│  │                                                            │   │
│  └────────────────┬───────────────────────────────────────────┘   │
└───────────────────┼─────────────────────────────────────────────┘
                    │
                    │ VSCode Message Passing API
                    │ (window.postMessage)
                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        WEBVIEW (Browser/React)                      │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │         Message Handler Hook                               │   │
│  │      (useVSCodeMessageHandler.ts)                          │   │
│  │                                                            │   │
│  │  window.addEventListener('message', (event) => {           │   │
│  │    const { type, ...payload } = event.data;               │   │
│  │                                                            │   │
│  │    // Fast path: Most messages use batch update           │   │
│  │    if (BATCH_UPDATE_MESSAGE_TYPES.includes(type)) {       │   │
│  │      store.batchUpdate(payload);                          │   │
│  │      return;                                              │   │
│  │    }                                                       │   │
│  │                                                            │   │
│  │    // Supported batch update types:                       │   │
│  │    // - ANALYSIS_STATE_UPDATE                             │   │
│  │    // - PROFILES_UPDATE                                   │   │
│  │    // - SERVER_STATE_UPDATE                               │   │
│  │    // - SETTINGS_UPDATE                                   │   │
│  │    // - CONFIG_ERRORS_UPDATE                              │   │
│  │    // - DECORATORS_UPDATE                                 │   │
│  │    // - SOLUTION_LOADING_UPDATE                           │   │
│  │    // - ANALYSIS_FLAGS_UPDATE                             │   │
│  │                                                            │   │
│  │    // Special cases (custom logic):                       │   │
│  │    switch (type) {                                        │   │
│  │      case "CHAT_MESSAGES_UPDATE":                         │   │
│  │        // Apply MAX_CHAT_MESSAGES limit                   │   │
│  │      case "CHAT_MESSAGE_STREAMING_UPDATE":                │   │
│  │        // Throttle streaming updates                      │   │
│  │      // ...                                               │   │
│  │    }                                                       │   │
│  │  })                                                        │   │
│  │                                                            │   │
│  └────────────────┬───────────────────────────────────────────┘   │
│                   │                                               │
│                   │ Updates React Zustand store                   │
│                   ▼                                               │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │              React Zustand Store                           │   │
│  │            (store.ts)                                      │   │
│  │                                                            │   │
│  │  State Properties (mirrors backend):                       │   │
│  │    • profiles: AnalysisProfile[]                           │   │
│  │    • ruleSets: RuleSet[]                                   │   │
│  │    • isAnalyzing: boolean                                  │   │
│  │    • serverState: ServerState                              │   │
│  │    • chatMessages: ChatMessage[]                           │   │
│  │    • ... (all UI state)                                    │   │
│  │                                                            │   │
│  │  Simple Setters (not domain actions):                      │   │
│  │    • setRuleSets(ruleSets)                                 │   │
│  │    • setProfiles(profiles)                                 │   │
│  │    • setIsAnalyzing(isAnalyzing)                           │   │
│  │    • batchUpdate(updates) ← Used by message handler        │   │
│  │    • ... (simple CRUD)                                     │   │
│  │                                                            │   │
│  │  Middleware:                                               │   │
│  │    • immer (mutable updates)                               │   │
│  │    • devtools (Redux DevTools)                             │   │
│  │    • persist (localStorage for UI preferences)             │   │
│  │                                                            │   │
│  └────────────────┬───────────────────────────────────────────┘   │
│                   │                                               │
│                   │ React subscriptions                           │
│                   ▼                                               │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │              React Components                              │   │
│  │                                                            │   │
│  │  const profiles = useExtensionStore(s => s.profiles);      │   │
│  │  const isAnalyzing = useExtensionStore(s => s.isAnalyzing);│   │
│  │                                                            │   │
│  │  // Selective subscriptions = No unnecessary re-renders    │   │
│  │                                                            │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Flow Example: User Configures Hub

Let's trace what happens when a user updates Hub configuration:

### 1. User Action in Webview

```typescript
// In React component
const handleSaveConfig = (config: HubConfig) => {
  // Webview sends message to extension
  vscode.postMessage({
    type: "UPDATE_HUB_CONFIG",
    config: config,
  });
};
```

### 2. Extension Receives Message

```typescript
// vscode/core/src/webviewMessageHandler.ts
[UPDATE_HUB_CONFIG]: async (config: HubConfig, state) => {
  // Save to disk
  await saveHubConfig(state.extensionContext, config);

  // Update connection manager
  await state.hubConnectionManager.updateConfig(config);

  // 🎯 Use domain action (not 3 separate mutate calls!)
  extensionStore.getState().hub.applyConfigurationFromUI(
    config,
    state.hubConnectionManager
  );
}
```

### 3. Domain Action Updates State

```typescript
// vscode/core/src/store/domains/hub.ts
applyConfigurationFromUI: (config, connectionManager) =>
  set((state) => {
    // Update all related state in one transaction
    state.hubConfig = config;
    state.profileSyncEnabled = config.profileSyncEnabled;
    state.solutionServerEnabled = config.solutionServerEnabled;

    // Business logic: If sync is disabled, mark as disconnected
    if (!config.profileSyncEnabled) {
      state.profileSyncConnected = false;
      state.isSyncingProfiles = false;
    }

    // Additional business logic...
  });
```

### 4. Sync Bridges Detect Changes

```typescript
// vscode/core/src/store/initializeSyncBridges.ts
// This bridge is watching for settings changes
manager.createBridge({
  selector: (state) => ({
    hubConfig: state.hubConfig,
    profileSyncEnabled: state.profileSyncEnabled,
    solutionServerEnabled: state.solutionServerEnabled,
    // ...
  }),
  messageType: "SETTINGS_UPDATE",
  equalityFn: equalityFns.shallow, // Prevents duplicate broadcasts
  debugName: "settings",
});
```

The sync bridge:

1. Runs the selector on new state
2. Compares with previous state using shallow equality
3. If changed, broadcasts to all webviews:

```typescript
{
  type: "SETTINGS_UPDATE",
  hubConfig: { ... },
  profileSyncEnabled: true,
  solutionServerEnabled: true,
  // ...
  timestamp: "2024-01-01T12:00:00Z"
}
```

### 5. Webview Receives Update

```typescript
// webview-ui/src/hooks/useVSCodeMessageHandler.ts
const handleMessage = (event: MessageEvent) => {
  const { type, ...payload } = event.data;

  // "SETTINGS_UPDATE" is in BATCH_UPDATE_MESSAGE_TYPES
  if (BATCH_UPDATE_MESSAGE_TYPES.includes(type)) {
    // Fast path: Direct batch update
    store.batchUpdate(payload);
    return;
  }
};
```

### 6. React Store Updates

```typescript
// webview-ui/src/store/store.ts
batchUpdate: (updates) =>
  set((state) => {
    Object.assign(state, updates);
    // Now state.hubConfig, state.profileSyncEnabled, etc. are updated
  });
```

### 7. React Components Re-render

```typescript
// In React component
const hubConfig = useExtensionStore((s) => s.hubConfig);
const profileSyncEnabled = useExtensionStore((s) => s.profileSyncEnabled);

// Components using these selectors automatically re-render
// Components NOT using these selectors don't re-render (selective subscriptions!)
```

## Key Architecture Principles

### 🎯 Single Source of Truth

- **Extension store** = Source of truth (Node.js)
- **Webview store** = Read-only replica for UI (Browser)
- State flows one direction: Extension → Webview

### 🔄 Declarative Sync

- No manual `sendMessageToWebview()` calls scattered in code
- Define sync bridges once in `initializeSyncBridges.ts`
- Bridges automatically handle all broadcasting

### ⚡ Performance Optimizations

- **Equality functions**: Prevent duplicate broadcasts
  - `equalityFns.shallow` for objects (checks all properties)
  - `equalityFns.deep` for complex nested objects (expensive)
  - Default reference equality for primitives

- **Selective selectors**: Only sync what's needed

  ```typescript
  // Good: Only sync boolean flags (cheap)
  selector: (state) => ({ isAnalyzing: state.isAnalyzing })

  // Also good: Sync large arrays with shallow equality check
  selector: (state) => ({ ruleSets: state.ruleSets }),
  equalityFn: equalityFns.shallow
  ```

- **Batch updates**: Webview uses `batchUpdate()` for atomic state changes
  ```typescript
  // Single Zustand transaction = single React re-render
  store.batchUpdate({
    hubConfig: newConfig,
    profileSyncEnabled: true,
    solutionServerEnabled: true,
  });
  ```

### 🏗️ Domain-Driven Actions (Extension Only)

The extension store has **business-focused domain actions**:

```typescript
// ✅ Good: Expresses business intent
extensionStore.getState().hub.applyConfigurationFromUI(config, manager);
extensionStore.getState().analysis.complete({ ruleSets, incidents });
extensionStore.getState().profiles.load(profiles, activeId);

// ❌ Bad: Generic CRUD (old approach)
state.mutateSettings({ hubConfig: config });
state.mutateSettings({ profileSyncEnabled: true });
state.mutateHub({ solutionServerEnabled: true });
```

**Why domain actions only in extension?**

- Extension = Business logic lives here
- Webview = Dumb presentation layer, just renders state
- Webview doesn't make decisions, just displays what extension tells it

### 📦 State Property Naming

To avoid conflicts between state properties and domain namespaces:

```typescript
// State property (data storage)
profilesList: AnalysisProfile[]

// Domain namespace (business operations)
profiles: {
  load: (profiles, activeId) => void;
  add: (profile) => void;
  // ...
}
```

## Sync Bridge Configuration

### When to Create a Bridge

**Create a bridge when:**

- State needs to be displayed in UI
- State changes frequently
- Multiple webviews need the same state

**Don't create a bridge when:**

- State is internal to extension (e.g., file handles, logger instances)
- State is fetched on-demand (e.g., chat message pagination)
- State is write-only (e.g., analytics events)

### Choosing Equality Functions

```typescript
// Reference equality (default) - Use for primitives and small objects
selector: (state) => ({ isAnalyzing: state.isAnalyzing })
// No equalityFn needed

// Shallow equality - Use for objects with primitive properties
selector: (state) => ({
  ruleSets: state.ruleSets,
  enhancedIncidents: state.enhancedIncidents
}),
equalityFn: equalityFns.shallow
// Checks: prev.ruleSets === next.ruleSets

// Deep equality - Use sparingly! Expensive!
selector: (state) => ({
  complexNestedObject: state.complexNestedObject
}),
equalityFn: equalityFns.deep
// Does: JSON.stringify(prev) === JSON.stringify(next)
```

## Message Types

### Sync Bridge Messages (Automatic)

These are broadcasted automatically by sync bridges:

- `ANALYSIS_STATE_UPDATE` - Analysis data and progress
- `PROFILES_UPDATE` - Profile list and active profile
- `SERVER_STATE_UPDATE` - Server status and connection flags
- `SETTINGS_UPDATE` - Extension settings and Hub config
- `CONFIG_ERRORS_UPDATE` - Configuration error list
- `DECORATORS_UPDATE` - Active diff decorators
- `SOLUTION_LOADING_UPDATE` - Solution fetch status
- `ANALYSIS_FLAGS_UPDATE` - Analysis boolean flags

### Manual Messages (Special Cases)

These are sent manually with custom logic:

- `CHAT_MESSAGES_UPDATE` - Full chat message list (on-demand fetch)
- `CHAT_MESSAGE_STREAMING_UPDATE` - Streaming message update (throttled)
- `SOLUTION_WORKFLOW_UPDATE` - Solution workflow state (has side effects)

## Benefits of This Architecture

### ✅ Maintainability

- **Declarative**: Sync rules defined once, applied everywhere
- **Type-safe**: Full TypeScript support across extension ↔ webview boundary
- **Debuggable**: All sync bridges visible in one file
- **Traceable**: Message type → Bridge → Selector chain is clear

### ✅ Performance

- **Selective subscriptions**: Components only re-render when their selected state changes
- **Equality checks**: Prevent duplicate broadcasts on identical state
- **Batch updates**: Multiple state changes = single re-render
- **Throttling**: Streaming updates don't overwhelm UI

### ✅ Scalability

- **Easy to add new state**: Create bridge → Add message handler → Done
- **Easy to refactor**: Change state shape → Update bridge selector → Update message handler
- **Easy to optimize**: Add equality function to reduce broadcasts

### ✅ Developer Experience

- **No boilerplate**: No Redux actions, reducers, or middleware to write
- **Intuitive API**: `store.batchUpdate(payload)` is self-documenting
- **Great debugging**: Redux DevTools works in webview
- **Clear separation**: Business logic (extension) vs presentation (webview)

## Migration Notes

### Old Pattern (Deprecated)

```typescript
// ❌ Manual broadcasts scattered everywhere
state.mutateAnalysis({ isAnalyzing: true });
webviewProvider.sendMessageToWebview({
  type: "ANALYSIS_UPDATE",
  isAnalyzing: true,
});

state.mutateAnalysis({ ruleSets: newRuleSets });
webviewProvider.sendMessageToWebview({
  type: "ANALYSIS_UPDATE",
  ruleSets: newRuleSets,
});
```

Problems:

- Easy to forget to broadcast
- Message types/payloads inconsistent
- Hard to track what syncs where

### New Pattern (Current)

```typescript
// ✅ Domain action + automatic sync
extensionStore.getState().analysis.begin();
// → Sync bridge automatically broadcasts ANALYSIS_FLAGS_UPDATE

extensionStore.getState().analysis.complete({ ruleSets, incidents });
// → Sync bridge automatically broadcasts ANALYSIS_STATE_UPDATE
```

Benefits:

- Can't forget to broadcast (automatic)
- Consistent message format (defined once)
- Easy to see what syncs (initializeSyncBridges.ts)

## Files Reference

### Extension (VSCode Core)

- [extensionStore.ts](../vscode/core/src/store/extensionStore.ts) - Vanilla Zustand store with domain actions
- [domains/](../vscode/core/src/store/domains/) - Domain action modules (hub, analysis, profiles, etc.)
- [syncBridge.ts](../vscode/core/src/store/syncBridge.ts) - Sync bridge utility
- [initializeSyncBridges.ts](../vscode/core/src/store/initializeSyncBridges.ts) - Bridge configuration

### Webview (React)

- [store/store.ts](../webview-ui/src/store/store.ts) - React Zustand store (replica)
- [hooks/useVSCodeMessageHandler.ts](../webview-ui/src/hooks/useVSCodeMessageHandler.ts) - Message handler hook

## Related Documentation

- [Modular Store Architecture](./MODULAR_STORE_ARCHITECTURE.md)
- [Domain Driven Store Redesign](./DOMAIN_DRIVEN_STORE_REDESIGN.md)
- [Naming Conflict Resolution](./NAMING_CONFLICT_RESOLUTION.md)
