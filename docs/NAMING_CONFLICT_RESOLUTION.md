# Naming Conflict Resolution

## Problem

When merging all domain actions into the extension store, TypeScript compilation failed with naming conflicts. The issue occurred when state properties had the same name as domain action namespaces:

```typescript
// State property
profilesList: AnalysisProfile[]

// Domain namespace
profiles: {
  load: () => void;
  add: () => void;
  // ...
}
```

When using the spread operator to merge domains, the domain namespace would overwrite the state property.

## Solution

Renamed conflicting state properties to be more specific while keeping domain namespaces business-focused:

### State Property Changes

| Old Name   | New Name       | Reason                                      |
| ---------- | -------------- | ------------------------------------------- |
| `profiles` | `profilesList` | Conflicted with `profiles` domain namespace |

### Why This Approach?

1. **Domain names reflect business intent**: Keeping `profiles` as the domain namespace makes the API intuitive:
   - `store.profiles.load()` - Load profiles
   - `store.profiles.add()` - Add a profile

2. **State properties are implementation details**: The state property `profilesList` is primarily accessed internally by domain actions. External code uses domain actions, not direct state access.

3. **Minimal impact**: Only a few files needed updates:
   - `extensionStore.ts` - State interface and initial state
   - `domains/profiles.ts` - Update references to state property
   - `extension.ts` - Update batch initialization call
   - `initializeSyncBridges.ts` - Update selector

## Files Modified

### Core Store Files

**vscode/core/src/store/extensionStore.ts**

- Updated `ExtensionStoreState` interface: `profiles` → `profilesList`
- Updated `initialState`: `profiles` → `profilesList`
- Updated `updateProfiles` parameter: `profiles` → `profilesList`
- Removed orphaned legacy setters (setSolutionServerEnabled, setIsAgentMode, etc.)

**vscode/core/src/store/domains/profiles.ts**

- Updated all references to `state.profiles` → `state.profilesList`

**vscode/core/src/store/initializeSyncBridges.ts**

- Updated profiles bridge selector: `state.profiles` → `state.profilesList`

**vscode/core/src/extension.ts**

- Updated profile initialization: `profiles:` → `profilesList:`

### Domain Action Fixes

**vscode/core/src/store/domains/chat.ts**

- Fixed `updateStreamingMessage` to update `msg.value.message` instead of non-existent `content` property
- Changed parameter name from `content` to `message` for clarity

**vscode/core/src/store/domains/server.ts**

- Fixed invalid ServerState value: `"failed"` → `"startFailed"` (matches type definition)

**vscode/core/src/store/domains/solutionWorkflow.ts**

- Fixed invalid SolutionState values:
  - `"complete"` → `"received"` (success means solution received)
  - `"cancelled"` → `"none"` (cancelled resets to initial state)

## Pattern for Future Domains

When creating new domain actions:

1. **Check for naming conflicts**: Before creating a domain namespace, check if a state property has the same name
2. **Prefer renaming state properties**: State properties are implementation details, domain namespaces are the public API
3. **Use descriptive state property names**: `profilesList`, `chatMessagesList`, etc. make it clear these are data storage
4. **Keep domain names business-focused**: `profiles`, `chat`, `analysis` express what the domain does

## Verification

Build completed successfully:

```bash
npm run build
# webpack 5.101.0 compiled successfully in 21207 ms
```

All TypeScript errors resolved:

- ✅ No naming conflicts between state and domain namespaces
- ✅ All domain actions properly typed
- ✅ All state properties correctly referenced
- ✅ Type safety maintained throughout

## Related Documentation

- [Modular Store Architecture](./MODULAR_STORE_ARCHITECTURE.md)
- [Domain Driven Store Redesign](./DOMAIN_DRIVEN_STORE_REDESIGN.md)
- [Store Cleanup Summary](./STORE_CLEANUP_SUMMARY.md)
