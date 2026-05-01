# Contributing Experimental Features

This guide explains how to add a new experimental feature to the Konveyor extension using the **feature module pattern**. Following this pattern ensures your feature is fully isolated from the core codebase — it can be enabled/disabled without affecting mainline code.

For a working example, see the Goose chat feature module in `src/features/goose/`.

## Overview

Experimental features are self-contained modules that:

1. Live in `src/features/<featureName>/`
2. Define their own types in `shared/src/types/<featureName>.ts`
3. Register their message handlers dynamically at runtime
4. Are gated behind a VS Code configuration setting
5. Cannot break the core extension if they fail to initialize

## Step 1: Define the feature flag

Add a configuration entry to `package.json` under `contributes.configuration.properties`:

```json
"konveyor-core.experimentalMyFeature.enabled": {
  "type": "boolean",
  "default": false,
  "description": "(Experimental) Enable my feature. Requires reload.",
  "scope": "window"
}
```

Add a configuration reader in `src/utilities/configuration.ts`:

```typescript
export function getConfigMyFeatureEnabled(): boolean {
  return (
    vscode.workspace
      .getConfiguration(EXTENSION_NAME)
      .get<boolean>("experimentalMyFeature.enabled") ?? false
  );
}
```

## Step 2: Define feature-specific types (if needed)

Create separate files in the shared package for your feature's types, actions, and messages:

- `shared/src/types/myFeature.ts` — type definitions
- `shared/src/types/myFeatureActions.ts` — action constants
- `shared/src/types/myFeatureMessages.ts` — message types and type guards

Add exports to `shared/src/types/index.ts`:

```typescript
export * from "./myFeature";
export * from "./myFeatureActions";
export * from "./myFeatureMessages";
```

**Do NOT** add your types to `types.ts`, `actions.ts`, or `messages.ts`. Those are core-only files.

## Step 3: Create the feature module

Create `src/features/myFeature/index.ts`:

```typescript
import type { FeatureModule, FeatureContext } from "../featureRegistry";
import { getConfigMyFeatureEnabled } from "../../utilities/configuration";
import * as vscode from "vscode";

export const myFeatureModule: FeatureModule = {
  id: "my-feature",
  name: "My Feature",

  isEnabled: () => getConfigMyFeatureEnabled(),

  async initialize(ctx: FeatureContext): Promise<vscode.Disposable> {
    const disposables: vscode.Disposable[] = [];

    // Register message handlers
    disposables.push(
      ctx.registerMessageHandlers({
        MY_FEATURE_ACTION: async (payload, state, logger) => {
          logger.info("Handling MY_FEATURE_ACTION", payload);
        },
      }),
    );

    // Set initial feature state
    ctx.mutate((draft) => {
      if (!draft.featureState) draft.featureState = {};
      draft.featureState.myFeature = { status: "idle" };
    });

    return vscode.Disposable.from(...disposables);
  },
};
```

## Step 4: Register the module

In `src/extension.ts`, import and register your module:

```typescript
import { myFeatureModule } from "./features/myFeature";

// In the experimental features section:
featureRegistry.register(myFeatureModule);
```

The `FeatureRegistry.initAll()` call handles checking your feature flag, calling `initialize()`, error handling, and disposal.

## What NOT to do

| Don't                                          | Do instead                                            |
| ---------------------------------------------- | ----------------------------------------------------- |
| Add fields to `ExtensionData` in `types.ts`    | Use `featureState` bag or your own type file          |
| Add action constants to `actions.ts`           | Create `myFeatureActions.ts`                          |
| Add message types to `messages.ts`             | Create `myFeatureMessages.ts`                         |
| Add handler code to `webviewMessageHandler.ts` | Register handlers via `ctx.registerMessageHandlers()` |
| Add init code to `extension.ts`                | Put it in your feature module's `initialize()`        |
| Import feature types in core type files        | Keep imports in your feature module only              |

**Note on sync bridges**: Sync bridges remain in `syncBridges.ts` co-located with core bridges. If your feature needs a sync bridge, add it directly to that file with a selector that reads from `featureState` (e.g., `s.featureState?.myFeature`).

## PR Checklist

Before submitting a PR for a new experimental feature:

- [ ] Feature flag defined in `package.json` and `configuration.ts`
- [ ] Feature types in `shared/src/types/<featureName>.ts` (not in core type files)
- [ ] Feature module created in `src/features/<featureName>/`
- [ ] Module registered in `extension.ts` via `featureRegistry.register()`
- [ ] No modifications to `types.ts`, `actions.ts`, `messages.ts`, or `webviewMessageHandler.ts`
- [ ] Feature works when enabled, core extension works when disabled
- [ ] Feature initialization failure does not break the extension
