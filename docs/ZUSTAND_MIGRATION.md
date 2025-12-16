# Zustand Vanilla Store Migration

## Overview

This document describes the new state management architecture using Zustand vanilla store with declarative sync bridges. This architecture provides better performance and maintainability compared to the previous imperative broadcast pattern.

## Architecture

### Components

1. **Vanilla Zustand Store** (`vscode/core/src/store/extensionStore.ts`)
   - Lives in the extension host (Node.js context)
   - Manages all extension state
   - Provides type-safe actions for state updates
   - Uses `subscribeWithSelector` and `immer` middleware

2. **Sync Bridges** (`vscode/core/src/store/syncBridge.ts`)
   - Declaratively connects store slices to webview broadcasts
   - Only syncs when selected state actually changes
   - Supports custom equality functions for expensive comparisons
   - Automatically broadcasts to all connected webviews

3. **Webview Store** (`webview-ui/src/store/store.ts`)
   - React Zustand store in the webview
   - Receives updates via VS Code message passing
   - Provides hooks for components to subscribe to state

## Benefits

### Over Previous Approach

- **Declarative vs Imperative**: Define sync rules once instead of manual broadcasts
- **Selective Updates**: Only broadcast changed slices, not full state
- **Type Safety**: Full TypeScript support throughout
- **Performance**: Avoid unnecessary re-renders and broadcasts
- **Maintainability**: Clear separation of concerns

### Specific Improvements

- **No 5MB payloads**: Boolean flags sync independently without large arrays
- **Reduced webview overhead**: Granular messages prevent unnecessary processing
- **Better debugging**: Each bridge is named and traceable

## Usage

### Phase 1: Foundation (Completed)

#### 1. Install Zustand

```json
// vscode/core/package.json
{
  "dependencies": {
    "zustand": "^5.0.8"
  }
}
```

#### 2. Create Store

```typescript
// vscode/core/src/store/extensionStore.ts
import { createStore } from "zustand/vanilla";
import { subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

export const extensionStore = createStore<ExtensionStore>()(
  subscribeWithSelector(
    immer((set) => ({
      // State
      isAnalyzing: false,

      // Actions
      setIsAnalyzing: (isAnalyzing) =>
        set((state) => {
          state.isAnalyzing = isAnalyzing;
        }),
    })),
  ),
);
```

#### 3. Create Sync Bridges

```typescript
// vscode/core/src/store/initializeSyncBridges.ts
export function initializeSyncBridges(
  webviewProviders: Map<string, KonveyorGUIWebviewViewProvider>,
  logger?: winston.Logger,
): SyncBridgeManager {
  const manager = new SyncBridgeManager(extensionStore, webviewProviders, logger);

  // Create bridge for boolean flags (cheap)
  manager.createBridge({
    selector: (state) => ({
      isFetchingSolution: state.isFetchingSolution,
    }),
    messageType: "SOLUTION_LOADING_UPDATE",
    debugName: "isFetchingSolution",
  });

  // Create bridge for large data with equality check (expensive)
  manager.createBridge({
    selector: (state) => ({
      ruleSets: state.ruleSets,
    }),
    messageType: "RULESETS_UPDATE",
    equalityFn: equalityFns.shallow,
    debugName: "ruleSets",
  });

  return manager;
}
```

### Phase 2: Migration Pattern

#### Before (Imperative):

```typescript
// Old approach: Manual mutation + broadcast
state.mutateSolutionWorkflow((draft) => {
  draft.isFetchingSolution = true;
});
```

#### After (Declarative):

```typescript
// New approach: Store action (bridge auto-broadcasts)
extensionStore.getState().setIsFetchingSolution(true);
```

### Phase 3: Webview Integration

#### Message Types

```typescript
// shared/src/types/messages.ts
export interface SolutionLoadingUpdateMessage {
  type: "SOLUTION_LOADING_UPDATE";
  isFetchingSolution: boolean;
  timestamp: string;
}
```

#### Message Handler

```typescript
// webview-ui/src/hooks/useVSCodeMessageHandler.ts
if (isSolutionLoadingUpdate(message)) {
  store.setIsFetchingSolution(message.isFetchingSolution);
  return;
}
```

## Migration Roadmap

### Completed

- ✅ Phase 1: Foundation (Issues 1-3)
  - Zustand installed and configured
  - Vanilla store created with full state shape
  - Sync bridge utility implemented

- ✅ Phase 2: Message Infrastructure (Issues 4-6)
  - New message types defined
  - Webview handlers added
  - Sync bridges initialized (not yet wired)

### In Progress

- ⏳ Phase 2: Integrate into Extension (Issue 4-6 completion)
  - Wire sync bridges into extension.ts activation
  - Replace mutate\* calls with store actions
  - Test that bridges work end-to-end

### Planned

- 📋 Phase 3: Expensive Updates (Issues 7-9)
  - Migrate ruleSets, enhancedIncidents, profiles
  - Add shallow equality checks

- 📋 Phase 4: Special Cases (Issues 10-12)
  - On-demand chat message fetching
  - Config errors and decorators

- 📋 Phase 5: Cleanup (Issues 13-15)
  - Remove legacy mutate\* functions
  - Optional: Remove old Context provider
  - Add debug middleware

## Best Practices

### When to Use Sync Bridges

✅ **Use for:**

- Boolean flags (cheap to sync)
- State that changes frequently
- State needed by all webviews
- Small objects with few fields

❌ **Don't use for:**

- Very large arrays (>1000 items)
- Data that changes on every keystroke
- Data needed by only one webview
- Chat messages (use on-demand fetch)

### Performance Tips

1. **Group related state**: Sync related fields together to reduce message count

   ```typescript
   // Good: Group server flags
   manager.createBridge({
     selector: (state) => ({
       serverState: state.serverState,
       isStartingServer: state.isStartingServer,
       isInitializingServer: state.isInitializingServer,
     }),
     messageType: "SERVER_STATE_UPDATE",
   });
   ```

2. **Use equality functions**: Prevent unnecessary syncs for expensive data

   ```typescript
   // Good: Shallow compare for objects/arrays
   manager.createBridge({
     selector: (state) => state.profiles,
     messageType: "PROFILES_UPDATE",
     equalityFn: equalityFns.shallow,
   });
   ```

3. **Batch updates**: Use batch actions when updating multiple fields

   ```typescript
   // Good: Single update
   extensionStore.getState().updateServerState({
     serverState: "running",
     isStartingServer: false,
   });

   // Bad: Multiple updates (fires bridge multiple times)
   const store = extensionStore.getState();
   store.setServerState("running");
   store.setIsStartingServer(false);
   ```

## Debugging

### View Active Bridges

```typescript
const manager = initializeSyncBridges(webviewProviders, logger);
console.log(manager.getDebugInfo());
// {
//   totalBridges: 6,
//   bridges: [
//     { messageType: "SOLUTION_LOADING_UPDATE", debugName: "isFetchingSolution", isActive: true },
//     ...
//   ]
// }
```

### Enable Logging

```typescript
// Pass logger to see bridge activity
const manager = initializeSyncBridges(webviewProviders, logger);
// Output:
// [SyncBridge isFetchingSolution] Broadcasted SOLUTION_LOADING_UPDATE
```

### Check Store State

```typescript
// Get current state snapshot
console.log(extensionStore.getState());
```

## Testing

### Unit Tests

```typescript
import { extensionStore } from "./extensionStore";

test("setIsAnalyzing updates state", () => {
  extensionStore.getState().setIsAnalyzing(true);
  expect(extensionStore.getState().isAnalyzing).toBe(true);
});
```

### Integration Tests

```typescript
test("sync bridge broadcasts on state change", async () => {
  const mockProvider = createMockWebviewProvider();
  const manager = new SyncBridgeManager(extensionStore, new Map([["test", mockProvider]]));

  manager.createBridge({
    selector: (state) => ({ isFetchingSolution: state.isFetchingSolution }),
    messageType: "SOLUTION_LOADING_UPDATE",
  });

  extensionStore.getState().setIsFetchingSolution(true);

  await waitFor(() => {
    expect(mockProvider.sendMessageToWebview).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "SOLUTION_LOADING_UPDATE",
        isFetchingSolution: true,
      }),
    );
  });
});
```

## FAQ

### Q: Can I use both old and new approaches during migration?

Yes! The sync bridges and old mutate\* functions can coexist. This allows incremental migration.

### Q: What happens if a webview is not connected?

The sync bridge will try to send but gracefully fail. No error is thrown.

### Q: How do I handle backward compatibility?

Keep old message types working while adding new ones. Remove old types only after all code is migrated.

### Q: Should I use sync bridges for everything?

No. Chat messages, for example, should use on-demand fetching due to their size. See "Best Practices" above.

## Contributing

When adding new state to the store:

1. Add state field and action to `ExtensionStoreState` and `ExtensionStoreActions`
2. Implement action in store creation
3. Create message type in `shared/src/types/messages.ts`
4. Add type guard function
5. Update `WebviewMessage` union type
6. Add handler in `useVSCodeMessageHandler.ts`
7. Create sync bridge in `initializeSyncBridges.ts`
8. Document in this README

## References

- [Zustand Documentation](https://github.com/pmndrs/zustand)
- [Zustand Vanilla Store](https://github.com/pmndrs/zustand#using-vanilla-stores)
- [subscribeWithSelector Middleware](https://github.com/pmndrs/zustand#middleware)
