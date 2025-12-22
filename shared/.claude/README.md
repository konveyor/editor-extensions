# @editor-extensions/shared

## Purpose

Foundation workspace providing shared TypeScript types, interfaces, and utilities used across all other workspaces.

## Critical Build Requirement

**⚠️ WHENEVER YOU MODIFY ANY FILE IN THIS WORKSPACE:**

```bash
npm run build -w shared
```

**Why**: Other workspaces (`@vscode/*`, `@webview-ui`, `@agentic`) import from the **built distribution** (`dist/`), not the source files.

**Without rebuilding**:
- Type changes won't be visible in other workspaces
- You'll get "cannot find module" or type errors
- Imports will use stale/outdated types

## Development Workflow

**Watch mode** (auto-rebuilds on changes):
```bash
npm run dev -w shared
```

**Manual build**:
```bash
npm run build -w shared
```

## Key Exports

Located in `src/`:

### Types (`src/types/`)
- **types.ts** - Core domain types (ExtensionData, RuleSet, Incident, etc.)
- **messages.ts** - Extension ↔ Webview message types
- **actions.ts** - Action types
- **auth.ts** - Authentication types

### Utilities (`src/`)
- **labelSelector.ts** - Label selector matching
- **languageMapping.ts** - Language detection
- **diffUtils.ts** - Diff utilities
- **transformation.ts** - Data transformations
- **api.ts** - API type definitions

## Adding New Types

1. **Add to appropriate file** in `src/types/`:
   ```typescript
   export interface MyNewType {
     id: string;
     data: unknown;
   }
   ```

2. **Export from index** (usually already done via `export *`):
   ```typescript
   // src/types/index.ts
   export * from "./types";
   ```

3. **BUILD THE WORKSPACE** ⚠️:
   ```bash
   npm run build -w shared
   ```

4. **Use in other workspaces**:
   ```typescript
   import { MyNewType } from "@editor-extensions/shared";
   ```

## Build Output

The build produces:
- `dist/index.d.ts` - TypeScript definitions
- `dist/index.mjs` - ESM bundle
- `dist/index.cjs` - CommonJS bundle

## Package Configuration

Exports are configured in `package.json`:
```json
{
  "types": "./dist/index.d.ts",
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs"
}
```

## Common Patterns

### Extension ↔ Webview Messages

All message types are defined here for type safety across the extension/webview boundary.

**Adding a new message type**:
1. Define in `src/types/messages.ts`:
   ```typescript
   export interface MyUpdateMessage {
     type: "MY_UPDATE";
     data: MyData;
     timestamp: string;
   }
   ```

2. Add to union type:
   ```typescript
   export type WebviewMessage =
     | ExistingMessage
     | MyUpdateMessage;
   ```

3. Add type guard:
   ```typescript
   export function isMyUpdate(msg: WebviewMessage): msg is MyUpdateMessage {
     return (msg as any).type === "MY_UPDATE";
   }
   ```

4. **BUILD**: `npm run build -w shared`

## Testing

```bash
npm run test -w shared
```

Tests are in `src/__tests__/` using Mocha.
