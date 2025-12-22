# Workspace Dependencies and Build Process

## Workspace Structure

This project uses npm workspaces with a strict dependency hierarchy:

```
@editor-extensions/shared (foundational types & utilities)
    ↓
@editor-extensions/agentic (AI workflows)
    ↓
@vscode/core, @vscode/java, @vscode/javascript, @vscode/go, @webview-ui
```

## Critical Build Order

**IMPORTANT**: The `@shared` workspace MUST be built before any other workspace can use its types.

### Postinstall Hook

After running `npm install`, the following workspaces are automatically built:

- `@shared` (shared types and utilities)
- `@agentic` (AI agent workflows)

This is configured in the root `package.json`:

```json
"postinstall": "npm run build -w shared && npm run build -w agentic"
```

### When You Modify @shared

**If you add, modify, or remove any type/interface in `shared/src/`:**

1. You MUST run: `npm run build -w shared`
2. Or use watch mode during development: `npm run dev -w shared`

**Otherwise**, the changes will NOT be available to:

- `@vscode/core`
- `@vscode/java`
- `@vscode/javascript`
- `@vscode/go`
- `@webview-ui`
- `@agentic`

### Development Workflow

For active development, use the dev script which runs all workspaces in watch mode:

```bash
npm run dev
```

This command:

1. Starts `@shared` in watch mode
2. Waits for `shared/dist/index.mjs` to exist
3. Starts `@agentic` in watch mode
4. Waits for `shared/dist/index.mjs` to exist
5. Starts `@webview-ui` in development server mode
6. Starts all VSCode extension workspaces in watch mode

The wait-on delays ensure proper build sequencing.

## Workspace Details

### @editor-extensions/shared

- **Purpose**: Shared TypeScript types, interfaces, utilities
- **Output**: `dist/index.d.ts`, `dist/index.cjs`, `dist/index.mjs`
- **Build Tool**: Vite (library mode)
- **Exports**: Types, actions, messages, utilities
- **Build Command**: `npm run build -w shared`
- **Watch Command**: `npm run dev -w shared`

Key exports:

- Types from `src/types/` (ExtensionData, RuleSet, Incident, etc.)
- Message types for extension ↔ webview communication
- Utility functions (labelSelector, languageMapping, diffUtils)
- API interfaces

### @editor-extensions/agentic

- **Purpose**: AI agent workflow system using LangChain/LangGraph
- **Dependencies**: Depends on `@shared`
- **Build Tool**: Vite
- **Build Command**: `npm run build -w agentic`

### @editor-extensions/webview-ui

- **Purpose**: React frontend for VSCode webview panels
- **Build Tool**: Vite
- **Dependencies**: `@shared`, PatternFly components
- **Output**: `build/` directory
- **Dev Server**: `npm run start -w webview-ui`
- **Build Command**: `npm run build -w webview-ui`

### @vscode/core

- **Purpose**: Main VSCode extension
- **Build Tool**: Webpack
- **Dependencies**: `@shared`, `@agentic`
- **Output**: `out/` directory
- **Build Command**: `npm run build -w vscode/core`
- **Watch Command**: `npm run dev -w vscode/core`

### Language Extensions

- **@vscode/java**, **@vscode/javascript**, **@vscode/go**
- All follow the same pattern as `@vscode/core`
- Each can be built independently or via `npm run build`

## Common Build Commands

```bash
# Full clean build (all workspaces)
npm run build

# Build specific workspace
npm run build -w shared
npm run build -w vscode/core
npm run build -w webview-ui

# Development with watch mode
npm run dev                    # All workspaces
npm run dev -w shared          # Just shared
npm run dev -w vscode/core     # Just extension

# Clean everything
npm run clean                  # Remove dist/ and downloaded_assets/
npm run clean:all              # Also remove node_modules/

# Testing (builds first)
npm run test                   # All workspaces
npm run test -w tests          # Just E2E tests
```

## Distribution

The `dist` directory is created by the `npm run dist` script which:

1. Copies built files from each workspace
2. Structures them for packaging as VSCode extensions
3. Includes runtime assets (kai analyzer, JDT Language Server, rulesets)

```bash
npm run dist          # Create dist/ from all built workspaces
npm run package       # Create .vsix files from dist/
```

## Package Dependencies

The project uses workspace references with `@editor-extensions/*` and `@vscode/*` namespaces:

- Extensions import shared types: `import { ... } from "@editor-extensions/shared"`
- Webview imports shared types: `import { ... } from "@editor-extensions/shared"`
- Extensions use agentic workflows: `import { ... } from "@editor-extensions/agentic"`

These are resolved via npm workspaces, NOT published packages.
