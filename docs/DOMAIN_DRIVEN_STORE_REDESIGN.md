# Domain-Driven Store Actions: Mapping to Business Intent

## Current Problem: Actions Don't Reflect Business Operations

### ❌ Current Low-Level Approach

```typescript
// webviewMessageHandler.ts - UPDATE_HUB_CONFIG
extensionStore.getState().updateHubConfig(config, state.hubConnectionManager);
```

What does "updateHubConfig" mean? It's still too generic. The **business intent** is:

- "User saved new Hub settings from the UI"
- "Apply Hub configuration and reconnect services"
- "Update all derived state based on new config"

### ✅ Better: Business-Intent Actions

```typescript
// What we really want to express:
extensionStore.getState().hub.applyConfigurationFromUI(config);
```

---

## Proposed Redesign: Domain-Driven Organization

Instead of flat, generic actions, **organize by domain** with **business-focused operations**:

```typescript
export interface ExtensionStoreActions {
  // ============================================
  // HUB DOMAIN - All Hub integration operations
  // ============================================
  hub: {
    // User configures Hub from settings UI
    applyConfigurationFromUI: (config: HubConfig, connectionManager: HubConnectionManager) => void;

    // Connection lifecycle
    handleConnectionEstablished: (connectionManager: HubConnectionManager) => void;
    handleConnectionLost: (reason?: string) => void;
    retryConnection: (connectionManager: HubConnectionManager) => void;

    // Solution server operations
    solutionServer: {
      markConnected: () => void;
      markDisconnected: () => void;
      restart: (connectionManager: HubConnectionManager) => void;
    };

    // Profile sync operations
    profileSync: {
      begin: () => void;
      complete: (result: { success: boolean; profilesCount?: number }) => void;
      fail: (error: Error) => void;
      markConnected: () => void;
      markDisconnected: () => void;
      retry: (connectionManager: HubConnectionManager) => void;
    };
  };

  // ============================================
  // ANALYSIS DOMAIN - Code analysis operations
  // ============================================
  analysis: {
    // Analysis lifecycle
    begin: () => void;
    updateProgress: (progress: number, message?: string) => void;
    complete: (results: { ruleSets: RuleSet[]; incidents: EnhancedIncident[] }) => void;
    fail: (error: Error) => void;
    cancel: () => void;

    // Schedule management
    schedule: () => void;
    cancelScheduled: () => void;

    // Results management
    updateSuccessRates: (incidents: EnhancedIncident[]) => void;
    clearResults: () => void;
  };

  // ============================================
  // PROFILE DOMAIN - Analysis profile management
  // ============================================
  profiles: {
    // Profile CRUD operations
    load: (profiles: AnalysisProfile[], activeId: string | null) => void;
    add: (profile: AnalysisProfile) => void;
    update: (profileId: string, updates: Partial<AnalysisProfile>) => void;
    remove: (profileId: string) => void;

    // Active profile management
    activate: (profileId: string) => void;

    // Source mode management
    enterTreeMode: () => void; // Profiles from .konveyor/profiles
    exitTreeMode: () => void; // Profiles from user storage
  };

  // ============================================
  // SOLUTION WORKFLOW DOMAIN - AI solution generation
  // ============================================
  solutionWorkflow: {
    // Workflow lifecycle
    start: (scope: Scope) => void;
    waitForUserInteraction: () => void;
    resumeAfterInteraction: () => void;
    complete: (state: "success" | "cancelled" | "failed") => void;
    reset: () => void;

    // Batch review management
    beginBatchReview: (files: PendingBatchReviewFile[]) => void;
    updateBatchReviewFile: (messageToken: string, updates: Partial<PendingBatchReviewFile>) => void;
    removeBatchReviewFile: (messageToken: string) => void;
    completeBatchReview: () => void;

    // Processing state
    beginProcessingQueue: () => void;
    completeProcessingQueue: () => void;
  };

  // ============================================
  // SERVER DOMAIN - Analyzer server lifecycle
  // ============================================
  server: {
    start: () => void;
    initialize: () => void;
    markRunning: () => void;
    stop: () => void;
    fail: (error: Error) => void;
  };

  // ============================================
  // DECORATOR DOMAIN - UI decorations for diffs
  // ============================================
  decorators: {
    apply: (messageToken: string, filePath: string) => void;
    remove: (messageToken: string) => void;
    clearAll: () => void;
  };

  // ============================================
  // CONFIG DOMAIN - Configuration and errors
  // ============================================
  config: {
    // Error management
    reportError: (error: ConfigError) => void;
    clearError: (type: ConfigError["type"]) => void;
    clearAllErrors: () => void;

    // LLM error management
    reportLlmError: (error: LLMError) => void;
    clearLlmErrors: () => void;
  };

  // ============================================
  // SETTINGS DOMAIN - Extension settings
  // ============================================
  settings: {
    setAgentMode: (enabled: boolean) => void;
    detectContinueInstallation: (installed: boolean) => void;
    setWorkspace: (root: string) => void;
  };

  // ============================================
  // CHAT DOMAIN - Chat message management
  // ============================================
  chat: {
    addMessage: (message: ChatMessage) => void;
    updateStreamingMessage: (index: number, content: string) => void;
    clear: () => void;
    // Note: Chat messages use on-demand fetching, not sync bridge
  };

  // ============================================
  // UTILITY ACTIONS
  // ============================================
  reset: () => void;
}
```

---

## Example: Hub Configuration Flow

### ❌ Current Approach (Low-Level)

```typescript
[UPDATE_HUB_CONFIG]: async (config: HubConfig, state) => {
  await saveHubConfig(state.extensionContext, config);
  await state.hubConnectionManager.updateConfig(config);

  // What is this doing? Hard to understand business intent
  extensionStore.getState().updateHubConfig(config, state.hubConnectionManager);

  if (!state.hubConnectionManager.isProfileSyncConnected()) {
    extensionStore.getState().completeProfileSync();
  }
}
```

### ✅ New Approach (Business-Intent)

```typescript
[UPDATE_HUB_CONFIG]: async (config: HubConfig, state) => {
  await saveHubConfig(state.extensionContext, config);
  await state.hubConnectionManager.updateConfig(config);

  // Clear business intent - "User configured Hub from UI"
  extensionStore.getState().hub.applyConfigurationFromUI(config, state.hubConnectionManager);
}
```

**Implementation:**

```typescript
// In extensionStore.ts
hub: {
  applyConfigurationFromUI: (config, connectionManager) =>
    set((state) => {
      // Business logic: Update Hub config and all derived state
      state.hubConfig = config;

      // Business rule: Feature flags determine service enablement
      state.solutionServerEnabled = config.enabled && config.features.solutionServer.enabled;
      state.profileSyncEnabled = config.enabled && config.features.profileSync.enabled;

      // Business rule: Sync connection status from manager
      state.solutionServerConnected = connectionManager.isSolutionServerConnected();
      state.profileSyncConnected = connectionManager.isProfileSyncConnected();

      // Business rule: Clear syncing flag if not connected
      if (!connectionManager.isProfileSyncConnected()) {
        state.isSyncingProfiles = false;
      }
    }),
}
```

---

## Example: Profile Sync Flow

### ❌ Current Approach

```typescript
// syncHubProfiles command
if (!silent) {
  extensionStore.getState().startProfileSync();
}

try {
  const result = await profileSyncClient.syncProfiles(repoInfo, syncDir);
  // ... handle errors ...
} finally {
  if (!silent) {
    extensionStore.getState().completeProfileSync();
  }
}
```

### ✅ New Approach

```typescript
// syncHubProfiles command
if (!silent) {
  extensionStore.getState().hub.profileSync.begin();
}

try {
  const result = await profileSyncClient.syncProfiles(repoInfo, syncDir);

  if (result.success) {
    extensionStore.getState().hub.profileSync.complete(result);
  } else {
    extensionStore.getState().hub.profileSync.fail(new Error(result.error));
  }
} catch (error) {
  extensionStore.getState().hub.profileSync.fail(error);
}
```

**Implementation:**

```typescript
hub: {
  profileSync: {
    begin: () =>
      set((state) => {
        state.isSyncingProfiles = true;
      }),

    complete: (result) =>
      set((state) => {
        state.isSyncingProfiles = false;

        // Business logic: Update config errors based on sync result
        state.configErrors = state.configErrors.filter(
          (e) => e.type !== "no-hub-profiles" && e.type !== "hub-profile-sync-failed",
        );

        if (result.profilesCount === 0) {
          state.configErrors.push(createConfigError.noHubProfiles());
        }
      }),

    fail: (error) =>
      set((state) => {
        state.isSyncingProfiles = false;
        state.configErrors.push(createConfigError.hubProfileSyncFailed(error.message));
      }),
  },
}
```

---

## Example: Analysis Lifecycle

### ✅ Business-Intent Actions

```typescript
// Starting analysis
extensionStore.getState().analysis.begin();

// Progress updates
extensionStore.getState().analysis.updateProgress(50, "Analyzing dependencies...");

// Completion
extensionStore.getState().analysis.complete({
  ruleSets: [...],
  incidents: [...],
});

// Or failure
extensionStore.getState().analysis.fail(new Error("Analysis failed"));
```

Much clearer than:

```typescript
// ❌ Low-level, unclear intent
extensionStore.getState().setIsAnalyzing(true);
extensionStore.getState().setAnalysisProgress(50);
extensionStore.getState().updateAnalysisState({ ruleSets, incidents });
```

---

## Benefits of Domain-Driven Actions

### 1. **Self-Documenting**

```typescript
extensionStore.getState().hub.profileSync.begin();
// vs
extensionStore.getState().setIsSyncingProfiles(true);
```

### 2. **Encapsulates Business Rules**

All Hub config logic in `hub.applyConfigurationFromUI()` - not scattered across handlers.

### 3. **Grouped by Context**

All Hub operations under `hub.*`, all analysis under `analysis.*`, etc.

### 4. **Type-Safe Navigation**

IDE autocomplete shows relevant operations: `hub.[autocomplete shows Hub operations]`

### 5. **Easier Refactoring**

Change business rules in ONE place, all callers automatically updated.

### 6. **Testability**

```typescript
test("profile sync completion clears errors", () => {
  store.hub.profileSync.complete({ success: true, profilesCount: 5 });
  expect(store.getState().configErrors).not.toContainProfileSyncErrors();
});
```

---

## Migration Strategy

### Phase 1: Create Domain Namespaces

```typescript
export interface ExtensionStoreActions {
  // Keep existing flat actions for backward compatibility
  setIsAnalyzing: (isAnalyzing: boolean) => void;
  // ...

  // Add new domain-driven namespaces
  hub: { ... };
  analysis: { ... };
  profiles: { ... };
}
```

### Phase 2: Migrate High-Value Domains First

1. Hub integration (highest pain point) ✅
2. Profile sync
3. Analysis workflow
4. Solution workflow

### Phase 3: Deprecate Flat Actions

Mark old actions as `@deprecated`, guide developers to new domain actions.

### Phase 4: Remove Old Actions

Once all code migrated, clean up the flat actions.

---

## Conclusion

**Domain-driven actions map directly to business operations**, making code:

- **More readable** - Clear business intent
- **More maintainable** - Business logic encapsulated
- **More discoverable** - Grouped by domain context
- **More testable** - Business operations are explicit

Instead of thinking "I need to set these 5 flags", you think "The user configured Hub" → `hub.applyConfigurationFromUI()`.
