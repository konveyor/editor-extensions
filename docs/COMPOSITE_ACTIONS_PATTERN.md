# Composite Actions Pattern: Solving the State Update Problem

## The Problem

When using multiple `state.mutate*()` calls across different slices, it's **hard to track** which state needs updating and **easy to miss updates**:

### ❌ Before - Fragile Pattern

```typescript
// From webviewMessageHandler.ts UPDATE_HUB_CONFIG
[UPDATE_HUB_CONFIG]: async (config: HubConfig, state) => {
  await saveHubConfig(state.extensionContext, config);

  // Update 1: Settings slice
  state.mutateSettings((draft) => {
    draft.hubConfig = config;
    draft.solutionServerEnabled = config.enabled && config.features.solutionServer.enabled;
    draft.profileSyncEnabled = config.enabled && config.features.profileSync.enabled;
  });

  await state.hubConnectionManager.updateConfig(config);

  // Update 2: Server state slice (different slice!)
  state.mutateServerState((draft) => {
    draft.solutionServerConnected = state.hubConnectionManager.isSolutionServerConnected();
    draft.profileSyncConnected = state.hubConnectionManager.isProfileSyncConnected();
  });

  // Update 3: Settings again (scattered logic!)
  if (!state.hubConnectionManager.isProfileSyncConnected()) {
    state.mutateSettings((draft) => {
      draft.isSyncingProfiles = false;
    });
  }
}
```

**Problems:**

1. **3 separate mutations** for related state changes
2. **Cross-slice updates** require remembering to update both `mutateSettings` AND `mutateServerState`
3. **Scattered logic** - same slice updated in multiple places
4. **No atomicity** - intermediate states visible
5. **Easy to forget** - when adding Hub features, might miss one of these spots

---

## The Solution: Composite Actions

Add **domain-specific composite actions** to the store that bundle related state updates:

### ✅ After - Clean Pattern

```typescript
// In extensionStore.ts - define composite actions
export interface ExtensionStoreActions {
  // ... existing actions ...

  // Composite domain actions - bundle related state updates
  updateHubConfig: (config: HubConfig, connectionManager: {
    isSolutionServerConnected: () => boolean;
    isProfileSyncConnected: () => boolean;
  }) => void;

  startProfileSync: () => void;
  completeProfileSync: () => void;

  updateConnectionStatus: (connectionManager: {
    isSolutionServerConnected: () => boolean;
    isProfileSyncConnected: () => boolean;
    isLlmProxyAvailable: () => boolean;
  }) => void;
}

// Implementation - encapsulates all related updates
updateHubConfig: (config, connectionManager) =>
  set((state) => {
    // All Hub-related state updates in one place
    state.hubConfig = config;
    state.solutionServerEnabled = config.enabled && config.features.solutionServer.enabled;
    state.profileSyncEnabled = config.enabled && config.features.profileSync.enabled;
    state.solutionServerConnected = connectionManager.isSolutionServerConnected();
    state.profileSyncConnected = connectionManager.isProfileSyncConnected();
  }),
```

### Usage - Much Cleaner

```typescript
// From webviewMessageHandler.ts - now clean and atomic
[UPDATE_HUB_CONFIG]: async (config: HubConfig, state) => {
  await saveHubConfig(state.extensionContext, config);
  await state.hubConnectionManager.updateConfig(config);

  // Single atomic update - all Hub config changes
  extensionStore.getState().updateHubConfig(config, state.hubConnectionManager);

  // Clear sync flag if needed
  if (!state.hubConnectionManager.isProfileSyncConnected()) {
    extensionStore.getState().completeProfileSync();
  }
}
```

---

## Benefits

### 1. **Single Source of Truth**

All Hub config logic is in ONE place in the store, not scattered across handlers.

### 2. **Atomic Updates**

All related state changes happen in a single `set()` call - no intermediate states.

### 3. **Easier to Maintain**

When adding new Hub features, you only update the composite action - all callers automatically get the new behavior.

### 4. **Clearer Intent**

`updateHubConfig()` is more meaningful than three separate `mutate*()` calls.

### 5. **Fewer Bugs**

Can't forget to update a related slice because the composite action handles it.

---

## More Examples

### Profile Sync Command

#### ❌ Before - Manual Flag Management

```typescript
// Start
state.mutateSettings((draft) => {
  draft.isSyncingProfiles = true;
});

// ... do sync work ...

// End (in finally block)
state.mutateSettings((draft) => {
  draft.isSyncingProfiles = false;
});
```

#### ✅ After - Semantic Actions

```typescript
// Start
extensionStore.getState().startProfileSync();

// ... do sync work ...

// End (in finally block)
extensionStore.getState().completeProfileSync();
```

### Connection Status Updates

#### ❌ Before - Multiple Mutate Calls

```typescript
state.mutateServerState((draft) => {
  draft.solutionServerConnected = state.hubConnectionManager.isSolutionServerConnected();
});

state.mutateServerState((draft) => {
  draft.profileSyncConnected = state.hubConnectionManager.isProfileSyncConnected();
});

state.mutateSettings((draft) => {
  draft.llmProxyAvailable = state.hubConnectionManager.isLlmProxyAvailable();
});
```

#### ✅ After - Single Composite Action

```typescript
extensionStore.getState().updateConnectionStatus(state.hubConnectionManager);
```

---

## When to Create Composite Actions

Create a composite action when:

1. **Multiple slices** need updating together (e.g., settings + server state)
2. **Related fields** change as a group (e.g., all Hub config fields)
3. **Temporal coupling** exists (start/complete pairs)
4. **Business logic** requires coordination (e.g., enabling feature X enables Y)
5. **Error-prone patterns** emerge (developers forgetting to update related state)

---

## Migration Strategy

### Phase 1: Add Composite Actions (Done ✅)

- Added `updateHubConfig()`, `startProfileSync()`, `completeProfileSync()`, `updateConnectionStatus()`
- Keep `mutate*()` wrappers for backward compatibility

### Phase 2: Migrate High-Value Commands (In Progress 🔄)

- **Done:** `UPDATE_HUB_CONFIG`, `syncHubProfiles`, `restartSolutionServer`, `retryProfileSync`
- **Next:** Other Hub/connection related commands

### Phase 3: Create More Composite Actions (Planned 📋)

- Analysis workflow bundles
- Profile management bundles
- Decorator lifecycle bundles

### Phase 4: Remove Mutate Wrappers (Future)

- Once all code migrated to direct store usage
- Remove the indirection layer entirely

---

## Best Practices

### ✅ DO

```typescript
// Create semantic composite actions for common patterns
extensionStore.getState().updateHubConfig(config, connectionManager);
extensionStore.getState().startProfileSync();
extensionStore.getState().completeProfileSync();
```

### ❌ DON'T

```typescript
// Don't scatter related updates
state.mutateSettings(...);
// ... 50 lines of code ...
state.mutateServerState(...);
// ... 30 more lines ...
state.mutateSettings(...); // Oops, settings again!
```

---

## Conclusion

**Composite actions solve the state management problem** by:

1. Encapsulating related state updates in the store
2. Providing semantic, domain-specific APIs
3. Eliminating scattered, error-prone mutation calls
4. Making code easier to understand and maintain

The result: **fewer bugs, clearer intent, and easier maintenance**.
