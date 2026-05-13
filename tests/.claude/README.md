# tests/

## Purpose

E2E and integration testing for the Konveyor VSCode extension using Playwright.

## Framework

- **Playwright** - E2E testing
- **@vscode/test-electron** - VSCode test runner
- **Mocha** - Some unit tests

## Running Tests

```bash
# All tests (builds first)
npm run test

# Just E2E tests
npm run test -w tests

# Specific project
npx playwright test --project=base
npx playwright test --project=solution-server-tests

# Specific file
npx playwright test tests/e2e/tests/base/my-test.test.ts

# Interactive UI mode
npx playwright test --ui

# Debug mode
npx playwright test --debug

# Headed mode (Applies to runs on VSCode Web only)
npx playwright test --headed
```

## Test Projects

Defined in `playwright.config.ts`:

### 1. base
- **Pattern**: `**/base/**/*.test.ts`
- **Purpose**: Core functionality
- **Examples**: Profile management, configuration

### 2. solution-server-tests
- **Pattern**: `**/solution-server/**/*.test.ts`
- **Purpose**: AI solution generation tests
- **Requires**: LLM provider configured

### 3. analysis-tests
- **Pattern**: `/.*analyze.+\.test\.ts/`
- **Purpose**: Analysis validation
- **Depends on**: `base` project

### 4. agent-flow-tests
- **Pattern**: `/.*agent_flow.+\.test\.ts/`
- **Purpose**: Agentic workflow automation tests

## Configuration

**File**: `playwright.config.ts`

Key settings:
- Timeout: 120 seconds per test
- Workers: 1 (sequential execution)
- Viewport: 1920x1080
- Screenshot: on failure (Applies to web mode only)
- Trace: on failure

## Test Structure

### Page Objects
**Location**: `e2e/pages/`

```typescript
import { BasePage } from "../../pages/base.page";

test("should do something", async ({ page }) => {
  const basePage = new BasePage(page);
  await basePage.navigateTo("konveyor");
  await basePage.clickButton();
});
```

### Utilities
**Location**: `e2e/utilities/`

- `vscode-commands.utils.ts` - VSCode command helpers
- `file.utils.ts` - File operations
- `logger.ts` - Test logging
- `evaluation.utils.ts` - Solution quality evaluation

### Fixtures
**Location**: `e2e/fixtures/`

- `provider-configs.fixture.ts` - LLM provider configurations
- `test-repo-fixture.ts` - Test repository setup

### Enums
**Location**: `e2e/enums/`

- `extension-types.enum.ts` - Extension types
- `llm-providers.enum.ts` - LLM provider types
- `views.enum.ts` - UI views
- `fix-types.enum.ts` - Solution fix types

## Environment Setup

Tests use `.env` files:

```bash
# .env (local)
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...

# .env.ci (CI/CD)
LLM_PROVIDER=mock
```

## Global Setup

**File**: `global.setup.ts`

Runs before all tests:
- Downloads test repositories
- Configures extensions
- Sets up runtime assets

## Writing Tests

### Basic Test

```typescript
import { test, expect } from "@playwright/test";
import { BasePage } from "../../pages/base.page";

test.describe("My Feature", () => {
  test("should work correctly", async ({ page }) => {
    const basePage = new BasePage(page);

    await basePage.navigateTo("konveyor");
    await basePage.doAction();

    await expect(page.locator(".result")).toBeVisible();
  });
});
```

### With Timeout

```typescript
test("long running test", async ({ page }) => {
  test.setTimeout(300000); // 5 minutes

  // ... test logic
});
```

## Kai Evaluator

**Location**: `kai-evaluator/`

Advanced AI-powered solution evaluation:
- Uses LangChain agents
- Evaluates solution quality
- Checks build success
- Measures test coverage

```typescript
// agents/evaluation.agent.ts
// chains/evaluation.chain.ts
// prompts/evaluation.prompt.ts
```

## MCP Client Testing

**Location**: `mcp-client/`

Tests for Model Context Protocol integration:
- `mcp-client.model.ts`
- `mcp-client-responses.model.ts`

## Solution Server Auth

**Location**: `solution-server-auth/`

Authentication testing:
- `authentication-manager.ts`
- `utils.ts`

## Debug Output

Artifacts saved to `test-output/`:
- Screenshots (on failure)
- Trace files
- Console logs

**View trace**:
```bash
npx playwright show-trace test-output/trace.zip
```

## CI/CD

Tests run in GitHub Actions:
- Uses `.env.ci` for config
- Stricter validation (`forbidOnly`)
- Saves artifacts on failure

## Common Patterns

### Wait for Extension Ready

```typescript
await basePage.waitForExtensionReady();
```

### Execute VSCode Command

```typescript
import { executeVSCodeCommand } from "../utilities/vscode-commands.utils";

await executeVSCodeCommand(page, "konveyor-core.runAnalysis");
```

### File Operations

```typescript
import { readTestFile, writeTestFile } from "../utilities/file.utils";

const content = await readTestFile(page, "path/to/file");
await writeTestFile(page, "path/to/file", newContent);
```

## Troubleshooting

### Test Timeout
- Increase timeout: `test.setTimeout(180000)`
- Check if extension is slow to start
- Verify analyzer is running

### Extension Not Loading
- Check build completed: `npm run build`
- Verify assets downloaded: `npm run collect-assets:dev`
- Check test output logs

### Screenshots Not Capturing
- Known Playwright limitation with Electron
- Use trace files instead

## Best Practices

1. **Use Page Objects** - Don't use raw selectors in tests
2. **Wait for Elements** - Use `waitFor*` methods
3. **Set Timeouts** - For long operations
4. **Clean State** - Each test should be independent
5. **Meaningful Names** - Describe what's being tested
6. **Avoid accessing local files** - When the tests are executed in VSCode Web, the tests won't be able to open files locally
7. **Prefer Assertions over Explicit Waits** - Replace `page.waitForTimeout()` with assertions like `expect(element).toBeVisible()`. Assertions have built-in auto-waiting and make tests more reliable and faster