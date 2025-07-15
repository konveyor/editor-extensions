# Logger Migration Plan

## Overview

This document outlines the plan for migrating all console.log, console.error, console.warn, and console.info statements to use Winston logging through the `state.logger` instance.

## Configuration Changes

- Removed `ServerLogLevels` type from `client/types.ts` (unused)
- Removed `ServerCliArguments` interface from `client/types.ts` (unused)
- Removed `KaiLogConfig` interface from `client/types.ts` (unused)
- Removed `KaiRpcApplicationConfig` interface from `client/types.ts` (unused)
- Updated `package.json` configuration to use Winston's standard log levels
- Updated `getConfigLogLevel()` to return Winston levels directly (no mapping needed)

## Winston Log Levels

We now use Winston's standard npm log levels directly:

- `error` - For errors that need immediate attention
- `warn` - For warnings that should be noted
- `info` - For general informational messages
- `debug` - For debugging information
- `verbose` - For very detailed debugging (rarely used)
- `silly` - For extremely detailed debugging (rarely used)

## Migration Strategy

1. Replace `console.log` with `state.logger.info`
2. Replace `console.error` with `state.logger.error`
3. Replace `console.warn` with `state.logger.warn`
4. Replace `console.info` with `state.logger.info`
5. For diagnostic/tracing messages, use `state.logger.debug`

## Files to Migrate

### High Priority (Error Handling)

- [x] `vscode/src/extension.ts` - 5 console.error statements
- [ ] `vscode/src/commands.ts` - 17 console.error statements
- [ ] `vscode/src/utilities/profiles/profileService.ts` - 1 console.error statement
- [ ] `vscode/src/utilities/fileUtils.ts` - 1 console.warn, 1 console.error
- [ ] `vscode/src/utilities/configuration.ts` - 1 console.error
- [ ] `vscode/src/data/virtualStorage.ts` - 1 console.error
- [ ] `vscode/src/diffView/copyCommands.ts` - 2 console.error statements
- [ ] `vscode/src/data/analyzerResults.ts` - 2 console.error statements
- [ ] `vscode/src/ViolationCodeActionProvider.ts` - 2 console.error statements
- [ ] `vscode/src/diffView/solutionCommands.ts` - 3 console.error statements
- [ ] `vscode/src/webviewMessageHandler.ts` - 1 console.error statement
- [ ] `vscode/src/analysis/batchedAnalysisTrigger.ts` - 2 console.error statements
- [ ] `vscode/src/KonveyorGUIWebviewViewProvider.ts` - 1 console.error statement

### Medium Priority (Informational Logging)

- [x] `vscode/src/extension.ts` - 3 console.log statements
- [ ] `vscode/src/commands.ts` - 3 console.log statements
- [ ] `vscode/src/webviewMessageHandler.ts` - 1 console.log statement
- [ ] `vscode/src/data/virtualStorage.ts` - 1 console.log statement
- [ ] `vscode/src/analysis/batchedAnalysisTrigger.ts` - 1 console.log statement
- [ ] `vscode/src/paths.ts` - 2 console.log statements
- [ ] `vscode/src/commands.ts` - 1 console.info statement

## Implementation Notes

### For Functions with Access to State

Most command handlers and extension methods already have access to `state.logger`:

```typescript
// Before
console.error("Error connecting to solution server:", error);

// After
state.logger.error("Error connecting to solution server", { error });
```

### For Utility Functions Without State Access

For utility functions that don't have access to the extension state, we have a few options:

1. **Pass logger as parameter** (Recommended):

```typescript
function utilityFunction(param: string, logger: winston.Logger) {
  logger.info("Processing utility function", { param });
}
```

2. **Create a separate logger instance** (For standalone utilities):

```typescript
import { createLogger } from "./logger";
import { paths } from "../paths";

const logger = createLogger(paths());
logger.info("Utility function called");
```

3. **Return to using console for truly standalone utilities** (Last resort):
   Keep console.log for utilities that are completely standalone and don't need structured logging.

## Structured Logging Benefits

When migrating, take advantage of Winston's structured logging:

```typescript
// Instead of string concatenation
console.log(`Analysis completed for ${filePath} with ${errorCount} errors`);

// Use structured logging
state.logger.info("Analysis completed", {
  filePath,
  errorCount,
  timestamp: new Date().toISOString(),
});
```

## Testing Strategy

1. Test in development mode to ensure console output still works
2. Verify logs appear in the "Konveyor Editor Extension" output channel
3. Check that log files are created in the expected location
4. Ensure log rotation works properly

## Timeline

- Phase 1: High priority error handling (Week 1)
- Phase 2: Medium priority informational logging (Week 2)
- Phase 3: Testing and refinement (Week 3)
