# Zustand Store Integration Example

This document shows how to integrate the vanilla Zustand store into the extension activation.

## Integration Steps

### 1. Initialize Store and Bridges on Extension Activation

```typescript
// vscode/core/src/extension.ts

import { extensionStore, initializeSyncBridges, SyncBridgeManager } from "./store";

class VsCodeExtension {
  private syncBridgeManager?: SyncBridgeManager;

  async activate(context: vscode.ExtensionContext) {
    // ... existing initialization ...

    // Initialize sync bridges after webview providers are ready
    this.syncBridgeManager = initializeSyncBridges(this.state.webviewProviders, this.state.logger);

    // Initialize store state from current data
    extensionStore.getState().updateSettings({
      workspaceRoot: paths.workspaceRepo.toString(true),
      solutionServerEnabled: hubConfig?.features?.solutionServer?.enabled ?? false,
      isAgentMode: getConfigAgentMode(),
      // ... other initial state
    });

    // Register disposal
    context.subscriptions.push({
      dispose: () => {
        this.syncBridgeManager?.disposeAll();
      },
    });
  }
}
```

### 2. Replace Mutate Calls with Store Actions

#### Example: Migrating isFetchingSolution

**Before:**

```typescript
// Old approach
this.state.mutateSolutionWorkflow((draft) => {
  draft.isFetchingSolution = true;
});
```

**After:**

```typescript
// New approach (bridge auto-broadcasts)
extensionStore.getState().setIsFetchingSolution(true);
```

#### Example: Migrating Server State

**Before:**

```typescript
this.state.mutateServerState((draft) => {
  draft.serverState = "running";
  draft.isStartingServer = false;
  draft.solutionServerConnected = true;
});
```

**After:**

```typescript
// Single batch update (efficient)
extensionStore.getState().updateServerState({
  serverState: "running",
  isStartingServer: false,
  solutionServerConnected: true,
});
```

### 3. Coexistence Pattern (During Migration)

You can keep both old and new approaches working:

```typescript
// Update both old state and new store
this.state.mutateSolutionWorkflow((draft) => {
  draft.isFetchingSolution = true;
});
extensionStore.getState().setIsFetchingSolution(true);
```

Once all consumers are migrated, remove the old mutate call.

## Testing the Integration

### 1. Verify Bridges Are Active

Add debug logging to see bridge activity:

```typescript
const manager = initializeSyncBridges(webviewProviders, logger);
logger.info("Sync bridges initialized", manager.getDebugInfo());
```

### 2. Test State Updates

```typescript
// Update state
extensionStore.getState().setIsFetchingSolution(true);

// Verify state changed
console.log("Store state:", extensionStore.getState().isFetchingSolution);
```

### 3. Test Webview Updates

In your webview dev tools console:

```javascript
// Listen for messages
window.addEventListener("message", (event) => {
  console.log("Received message:", event.data);
});

// Trigger state change in extension
// You should see: { type: "SOLUTION_LOADING_UPDATE", isFetchingSolution: true, ... }
```

## Common Patterns

### Pattern 1: Simple Boolean Toggle

```typescript
// Extension code
extensionStore.getState().setIsAnalyzing(true);

// Later...
extensionStore.getState().setIsAnalyzing(false);
```

### Pattern 2: Batch Server State Update

```typescript
// Extension code - multiple related fields
extensionStore.getState().updateServerState({
  serverState: "running",
  isStartingServer: false,
  isInitializingServer: false,
  solutionServerConnected: true,
});
```

### Pattern 3: Update with Derived State

```typescript
// Extension code
const profiles = await getAllProfiles();
const isInTreeMode = profiles.some((p) => p.source === "hub");

extensionStore.getState().updateProfiles({
  profiles,
  isInTreeMode,
});
```

## Migration Checklist

For each state slice to migrate:

- [ ] Identify all mutate\* calls for that slice
- [ ] Create corresponding store actions
- [ ] Update message type if needed (most already exist)
- [ ] Update webview message handler if needed (most already exist)
- [ ] Replace mutate calls with store actions
- [ ] Test that webview receives updates
- [ ] Verify no performance regression
- [ ] Remove old mutate function once fully migrated

## Performance Validation

### Before Migration

```typescript
// Measure broadcast time
console.time("broadcast");
this.state.mutateSolutionWorkflow((draft) => {
  draft.isFetchingSolution = true;
});
console.timeEnd("broadcast");
// ~5-10ms with large state
```

### After Migration

```typescript
// Measure broadcast time
console.time("broadcast");
extensionStore.getState().setIsFetchingSolution(true);
console.timeEnd("broadcast");
// <1ms (only syncs the boolean)
```

## Rollback Strategy

If issues arise during migration:

1. **Individual slice rollback**: Re-enable old mutate call
2. **Bridge disable**: Comment out specific bridge in initializeSyncBridges
3. **Full rollback**: Don't initialize sync bridges, keep all mutate calls

The architecture supports gradual rollout and easy rollback.
