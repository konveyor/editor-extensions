# Modular Store Architecture

## Problem: Unwieldy Single-File Store

The `extensionStore.ts` file was becoming too large and mixing concerns:

- 700+ lines in a single file
- State definitions mixed with action implementations
- Hard to find specific domain logic
- Difficult to maintain and extend

## Solution: Domain-Driven Modular Architecture

Split the store into **domain-specific modules** that are:

- **Focused**: Each file handles one business domain
- **Composable**: Domains are merged into the main store
- **Maintainable**: Easy to find and update domain logic
- **Extensible**: Add new domains without touching existing ones

---

## File Structure

```
vscode/core/src/store/
├── extensionStore.ts          # Main store (state + composition)
├── syncBridge.ts              # Sync bridge utilities
├── initializeSyncBridges.ts   # Bridge initialization
└── domains/                   # Domain action modules
    ├── index.ts               # Exports all domains
    ├── hub.ts                 # Hub integration domain
    ├── analysis.ts            # Analysis domain
    ├── profiles.ts            # Profile management (future)
    ├── solutionWorkflow.ts    # Solution workflow (future)
    ├── server.ts              # Server lifecycle (future)
    ├── decorators.ts          # UI decorators (future)
    ├── config.ts              # Config & errors (future)
    ├── settings.ts            # Extension settings (future)
    └── chat.ts                # Chat messages (future)
```

---

## Domain Module Pattern

Each domain module follows this structure:

### 1. Type Definitions

```typescript
// domains/hub.ts
export interface HubDomainActions {
  hub: {
    applyConfigurationFromUI: (config: HubConfig, ...) => void;
    solutionServer: {
      markConnected: () => void;
      markDisconnected: () => void;
    };
    profileSync: {
      begin: () => void;
      complete: () => void;
      fail: () => void;
    };
  };
}
```

### 2. Action Creator

```typescript
export const createHubActions: StateCreator<
  ExtensionStore,
  [["zustand/subscribeWithSelector", never], ["zustand/immer", never]],
  [],
  HubDomainActions
> = (set) => ({
  hub: {
    applyConfigurationFromUI: (config, connectionManager) =>
      set((state) => {
        // Business logic here
        state.hubConfig = config;
        state.solutionServerEnabled = config.enabled && config.features.solutionServer.enabled;
        // ... more logic
      }),

    solutionServer: {
      markConnected: () =>
        set((state) => {
          state.solutionServerConnected = true;
        }),
      markDisconnected: () =>
        set((state) => {
          state.solutionServerConnected = false;
        }),
    },

    profileSync: {
      begin: () =>
        set((state) => {
          state.isSyncingProfiles = true;
        }),
      complete: () =>
        set((state) => {
          state.isSyncingProfiles = false;
        }),
      fail: () =>
        set((state) => {
          state.isSyncingProfiles = false;
        }),
    },
  },
});
```

---

## Main Store Composition

The main `extensionStore.ts` file now:

### 1. Imports Domain Modules

```typescript
import { createHubActions, createAnalysisActions, type HubDomainActions, type AnalysisDomainActions } from "./domains";
```

### 2. Composes the Store Type

```typescript
export type ExtensionStore = ExtensionStoreState & ExtensionStoreActions & HubDomainActions & AnalysisDomainActions;
```

### 3. Merges Domain Actions

```typescript
export const extensionStore = createStore<ExtensionStore>()(
  subscribeWithSelector(
    immer((set, get, store) => ({
      ...initialState,

      // Merge domain actions
      ...createHubActions(set, get, store),
      ...createAnalysisActions(set, get, store),

      // Legacy CRUD actions
      setIsAnalyzing: (isAnalyzing) =>
        set((state) => {
          state.isAnalyzing = isAnalyzing;
        }),
      // ...
    })),
  ),
);
```

---

## Current Domains

### ✅ Hub Domain (`domains/hub.ts`)

**Responsibilities:**

- Hub configuration management
- Connection status tracking
- Solution server lifecycle
- Profile sync operations

**Actions:**

- `hub.applyConfigurationFromUI()`
- `hub.connection.syncStatus()`
- `hub.solutionServer.markConnected/Disconnected()`
- `hub.profileSync.begin/complete/fail()`

### ✅ Analysis Domain (`domains/analysis.ts`)

**Responsibilities:**

- Analysis lifecycle management
- Progress tracking
- Results management
- Schedule management

**Actions:**

- `analysis.begin()`
- `analysis.updateProgress()`
- `analysis.complete()`
- `analysis.fail()`
- `analysis.schedule/cancelScheduled()`
- `analysis.updateSuccessRates()`
- `analysis.clearResults()`

---

## Benefits

### 1. **Separation of Concerns**

Each domain file handles ONE business area - easier to understand and maintain.

### 2. **Scalability**

Add new domains without touching existing code:

```typescript
// Just create domains/profiles.ts and merge it
...createProfileActions(set, get, store),
```

### 3. **Findability**

Need Hub logic? Go to `domains/hub.ts`. Need analysis logic? Go to `domains/analysis.ts`.

### 4. **Type Safety**

Each domain exports its own types, merged into the main store type.

### 5. **Testability**

Test domains in isolation:

```typescript
import { createHubActions } from "./domains/hub";

test("hub config applies correctly", () => {
  // Test just the Hub domain
});
```

### 6. **Reduced File Size**

- `extensionStore.ts`: ~350 lines (state + composition)
- `domains/hub.ts`: ~180 lines (Hub logic only)
- `domains/analysis.ts`: ~120 lines (Analysis logic only)

---

## Usage Examples

### From Command Handlers

```typescript
// webviewMessageHandler.ts
[UPDATE_HUB_CONFIG]: async (config: HubConfig, state) => {
  await saveHubConfig(state.extensionContext, config);
  await state.hubConnectionManager.updateConfig(config);

  // Domain action - clear business intent
  extensionStore.getState().hub.applyConfigurationFromUI(config, state.hubConnectionManager);
}
```

### From Commands

```typescript
// commands.ts - restartSolutionServer
if (state.hubConnectionManager.isSolutionServerConnected()) {
  extensionStore.getState().hub.solutionServer.markConnected();
} else {
  extensionStore.getState().hub.solutionServer.markDisconnected();
}
```

### From Analysis Code

```typescript
// analysis.ts
extensionStore.getState().analysis.begin();
extensionStore.getState().analysis.updateProgress(50, "Analyzing dependencies...");
extensionStore.getState().analysis.complete({ ruleSets, incidents });
```

---

## Adding a New Domain

### Step 1: Create Domain File

```typescript
// domains/profiles.ts
export interface ProfileDomainActions {
  profiles: {
    load: (profiles: AnalysisProfile[], activeId: string) => void;
    add: (profile: AnalysisProfile) => void;
    activate: (profileId: string) => void;
  };
}

export const createProfileActions: StateCreator<...> = (set) => ({
  profiles: {
    load: (profiles, activeId) => set((state) => {
      state.profiles = profiles;
      state.activeProfileId = activeId;
    }),
    add: (profile) => set((state) => {
      state.profiles.push(profile);
    }),
    activate: (profileId) => set((state) => {
      state.activeProfileId = profileId;
    }),
  },
});
```

### Step 2: Export from Index

```typescript
// domains/index.ts
export * from "./hub";
export * from "./analysis";
export * from "./profiles"; // Add this line
```

### Step 3: Merge into Store

```typescript
// extensionStore.ts
import {
  createHubActions,
  createAnalysisActions,
  createProfileActions, // Import
  type ProfileDomainActions, // Import type
} from "./domains";

export type ExtensionStore = ExtensionStoreState &
  ExtensionStoreActions &
  HubDomainActions &
  AnalysisDomainActions &
  ProfileDomainActions; // Add to type

export const extensionStore = createStore<ExtensionStore>()(
  subscribeWithSelector(
    immer((set, get, store) => ({
      ...initialState,
      ...createHubActions(set, get, store),
      ...createAnalysisActions(set, get, store),
      ...createProfileActions(set, get, store), // Merge
      // ...
    })),
  ),
);
```

Done! New domain integrated with **zero changes** to existing domain files.

---

## Migration Path

### Phase 1: Create Core Domains (Done ✅)

- Hub domain
- Analysis domain
- Modular file structure

### Phase 2: Add Remaining Domains (In Progress)

- Profiles domain
- Solution workflow domain
- Server domain
- Decorators domain
- Config domain
- Settings domain
- Chat domain

### Phase 3: Deprecate Legacy Actions

- Mark old flat actions as `@deprecated`
- Guide developers to domain actions
- Update all usage

### Phase 4: Remove Legacy Actions

- Clean up deprecated actions
- Pure domain-driven store

---

## Best Practices

### ✅ DO

```typescript
// Keep domain logic focused
hub.applyConfigurationFromUI(); // All Hub config logic in hub domain

// Group related operations
hub.solutionServer.markConnected();
hub.profileSync.begin();
```

### ❌ DON'T

```typescript
// Don't scatter domain logic across files
// All Hub logic should be in domains/hub.ts

// Don't create generic "utility" domains
// Each domain should have clear business focus
```

---

## Conclusion

The modular store architecture provides:

- **Better organization**: Logic grouped by business domain
- **Easier maintenance**: Find and update domain logic quickly
- **Scalability**: Add new domains without touching existing code
- **Type safety**: Full TypeScript support across all domains
- **Testability**: Test domains in isolation

The result: **A store that scales with your application's complexity while remaining maintainable and understandable.**
