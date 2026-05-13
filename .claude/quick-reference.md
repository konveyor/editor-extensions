# Quick Reference Guide

## Critical Workflows

### Adding/Modifying Types in @shared

**CRITICAL**: When you add or modify types/interfaces in `@editor-extensions/shared`:

1. Make your changes in `shared/src/types/`
2. **MUST RUN**: `npm run build -w shared`
3. Types are now available in other workspaces

**Why**: TypeScript types from `@shared` are only available after building to `dist/`. Other workspaces import from the built distribution, not the source files.

**Watch mode alternative**:

```bash
npm run dev -w shared  # Auto-rebuilds on changes
```

### Development Workflow

```bash
# Start everything in watch mode
npm run dev

# This runs:
# - shared in watch mode
# - agentic in watch mode
# - webview-ui dev server
# - all VSCode extensions in watch mode
```

### Testing Your Changes

```bash
# After making changes, run tests
npm run test

# Or test specific workspace
npm run test -w tests
npm run test -w shared
npm run test -w vscode/core
```

### Building for Distribution

```bash
# Full production build
npm run build

# Create distribution directory
npm run dist

# Package as .vsix files
npm run package                # All extensions
npm run package-core           # Just core
npm run package-java           # Just Java extension
```

## Common Commands Cheat Sheet

### Build Commands

```bash
npm run build                  # Build all workspaces
npm run build -w shared        # Build shared types
npm run build -w vscode/core   # Build core extension
npm run build -w webview-ui    # Build React UI
```

### Development Commands

```bash
npm run dev                    # Start all in watch mode
npm run dev -w shared          # Watch shared types
npm run dev -w vscode/core     # Watch extension
npm run start -w webview-ui    # Dev server for UI
```

### Clean Commands

```bash
npm run clean                  # Remove dist/ and downloaded_assets/
npm run clean:all              # Also remove node_modules/
npm run clean -w shared        # Clean specific workspace
```

### Asset Commands

```bash
npm run collect-assets         # Download from release
npm run collect-assets:dev     # Download from main branch
```

### Lint Commands

```bash
npm run lint                   # Lint all workspaces
npm run lint:fix               # Auto-fix issues
npm run lint -w vscode/core    # Lint specific workspace
```

## File Locations Reference

### Configuration Files

- `package.json` - Root workspace config
- `tsconfig.json` - TypeScript config (per workspace)
- `.eslintrc.*` - Linting config
- `vite.config.ts` - Vite build config (shared, webview-ui)
- `webpack.config.js` - Webpack config (VSCode extensions)

### Source Directories

- `shared/src/` - Shared types and utilities
- `webview-ui/src/` - React frontend
- `vscode/core/src/` - Main extension source
- `vscode/java/src/` - Java extension source
- `agentic/src/` - AI workflow system
- `tests/` - E2E and unit tests

### Build Outputs

- `shared/dist/` - Built types (CJS, ESM, .d.ts)
- `webview-ui/build/` - Built React app
- `vscode/*/out/` - Built extension code
- `dist/` - Distribution directory (for packaging)

### Runtime Assets

- `downloaded_assets/` - Kai analyzer, JDT LS, rulesets
- `assets/` - Static assets (icons, fernflower)

### User Configuration

- `~/.konveyor/llm-provider-settings.yaml` - LLM provider config
- `.vscode/settings.json` - VSCode workspace settings

## Common Import Patterns

### Importing from @shared

```typescript
import { ExtensionData, RuleSet, Incident, WebviewMessage } from "@editor-extensions/shared";
```

### Importing from @agentic

```typescript
import { KaiInteractiveWorkflow, KaiModelProvider } from "@editor-extensions/agentic";
```

### VSCode Extension Imports

```typescript
import * as vscode from "vscode";
import { produce } from "immer";
import winston from "winston";
```

### React/PatternFly Imports

```typescript
import React from "react";
import { Card, CardBody, Button } from "@patternfly/react-core";
import IconName from "@patternfly/react-icons/dist/esm/icons/icon-name";
import { useExtensionStore } from "../../store/store";
```

## Common Patterns

### Updating Extension State (Immer)

```typescript
import { produce } from "immer";

this.data = produce(this.data, (draft) => {
  draft.isAnalyzing = true;
  draft.analysisProgress = 50;
  draft.ruleSets = newRuleSets;
});

this._onDidChange.fire(this.data);
```

### Reading VSCode Configuration

```typescript
import * as vscode from "vscode";

const config = vscode.workspace.getConfiguration("konveyor-core");
const setting = config.get<boolean>("genai.enabled", true);
```

### Sending Messages to Webview

```typescript
webviewPanel.webview.postMessage({
  type: "ANALYSIS_STATE_UPDATE",
  ruleSets: this.data.ruleSets,
  isAnalyzing: this.data.isAnalyzing,
  timestamp: new Date().toISOString(),
});
```

### Using Zustand Store (React)

```typescript
import { useExtensionStore } from "../../store/store";

const MyComponent: React.FC = () => {
  const isAnalyzing = useExtensionStore((state) => state.isAnalyzing);
  const ruleSets = useExtensionStore((state) => state.ruleSets);

  return <div>{isAnalyzing ? "Analyzing..." : "Ready"}</div>;
};
```

### Dispatching Actions to Extension (React)

```typescript
import { sendVscodeMessage as dispatch } from "../../utils/vscodeMessaging";

const handleClick = () => {
  dispatch({
    type: "RUN_ANALYSIS",
    payload: { profileId: "my-profile" },
  });
};
```

## Troubleshooting

### "Cannot find module '@editor-extensions/shared'"

**Solution**: Build the shared workspace first

```bash
npm run build -w shared
```

### "Type X is not exported from @shared"

**Solution**: Export it in `shared/src/index.ts` or type file, then rebuild

```bash
# After adding export
npm run build -w shared
```

### Extension not loading in VSCode

**Solution**:

1. Check build completed: `npm run build -w vscode/core`
2. Check output channel: View → Output → Konveyor
3. Check logs for errors

### Webview not showing updates

**Solution**:

1. Check message types match in extension and webview
2. Check browser console (Help → Toggle Developer Tools)
3. Verify Zustand store is updating

### Assets not found

**Solution**: Download runtime assets

```bash
npm run collect-assets:dev
```

## IDE Integration

### VSCode Debugging

1. Open project in VSCode
2. Press F5 to start Extension Development Host
3. Set breakpoints in `.ts` files
4. Check Debug Console for output

### Webview Debugging

1. Open Extension Development Host
2. Open webview panel
3. Help → Toggle Developer Tools
4. Use browser DevTools for React debugging

## Performance Tips

### Faster Builds

- Use `npm run dev` for watch mode instead of repeated builds
- Build only changed workspaces: `npm run build -w shared`
- Use `npm run clean` before full rebuild if issues occur

### Faster Tests

- Run specific test project: `npx playwright test --project=base`
- Run specific test file instead of all tests
- Use `--headed` to see what's happening: `npx playwright test --headed`

## Version Control

### Files to Commit

- All source code in `src/` directories
- Configuration files (`package.json`, `tsconfig.json`, etc.)
- `.claude/` directory (documentation)
- `CLAUDE.md` (project instructions)

### Files to Ignore (already in .gitignore)

- `node_modules/`
- `dist/` and `*/dist/`
- `*/out/` and `*/build/`
- `downloaded_assets/`
- `*.vsix` (packaged extensions)
- Test output and traces
