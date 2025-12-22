# Claude Context Documentation

## Workspace-Specific Context

Each workspace has its own `.claude/README.md` with focused, relevant information:

- **[shared/.claude/](../shared/.claude/README.md)** - Shared types & utilities
  - **Critical**: Build requirement when modifying types
  - Type exports and message definitions

- **[webview-ui/.claude/](../webview-ui/.claude/README.md)** - React frontend
  - PatternFly 6.x components
  - Zustand state management
  - Extension communication patterns

- **[vscode/core/.claude/](../vscode/core/.claude/README.md)** - Main extension
  - Extension architecture
  - Immer state management
  - Commands, providers, and managers

- **[tests/.claude/](../tests/.claude/README.md)** - E2E testing
  - Playwright configuration
  - Test patterns and utilities

## Quick Reference

### Most Important Rule

**When modifying `@editor-extensions/shared`:**

```bash
npm run build -w shared
```

Other workspaces won't see changes until you rebuild!

### Common Commands

```bash
npm run dev                    # Start all in watch mode
npm run build                  # Build everything
npm run test                   # Run all tests
npm run dist                   # Create distribution
npm run package                # Package .vsix files
```

### Development Workflow

```bash
# Start watch mode for everything
npm run dev

# Or manually:
npm run dev -w shared          # Types (builds automatically)
npm run start -w webview-ui    # React dev server
npm run dev -w vscode/core     # Extension
```

### Tech Stack Summary

- **Shared**: Vite, TypeScript (types only)
- **Webview**: React 18, PatternFly 6.x, Zustand, Vite
- **Extension**: TypeScript, Webpack, Immer, LangChain
- **Testing**: Playwright, Mocha

## Reference Documentation

Large reference files (for occasional consultation):

- [architecture-overview.md](architecture-overview.md) - System architecture diagrams
- [common-tasks.md](common-tasks.md) - Step-by-step task guides
- [quick-reference.md](quick-reference.md) - Commands and patterns cheat sheet

## How to Use This Documentation

1. **Working on specific workspace?** → Check that workspace's `.claude/README.md`
2. **Need a task guide?** → See `common-tasks.md`
3. **Want architecture overview?** → See `architecture-overview.md`
4. **Need quick command?** → See `quick-reference.md`

## For AI Assistants

When working in a specific workspace, read that workspace's `.claude/README.md` for focused, relevant context. Only load the reference files if you need broader architectural understanding.

This keeps token usage efficient while providing comprehensive information.
