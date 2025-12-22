# Testing

## Test Structure

The project has comprehensive E2E testing using Playwright:

**Test location**: `tests/`

## Test Framework

- **Playwright** - E2E testing framework
- **VSCode Extension Testing** - VSCode-specific test utilities
- **Mocha** - Unit test framework (some workspaces)

## Playwright Configuration

**File**: `tests/playwright.config.ts`

### Test Projects

Tests are organized into projects:

1. **base** - Core functionality tests
   - Pattern: `**/base/**/*.test.ts`
   - Profile management, analysis configuration, etc.

2. **solution-server-tests** - Solution server integration
   - Pattern: `**/solution-server/**/*.test.ts`
   - Tests AI solution generation

3. **analysis-tests** - Analysis validation
   - Pattern: `/.*analyze.+\.test\.ts/`
   - Depends on: `base` project

4. **agent-flow-tests** - Agentic workflow tests
   - Pattern: `/.*agent_flow.+\.test\.ts/`
   - Tests automated fix workflows

### Test Configuration

```typescript
{
  testDir: './e2e/tests',
  outputDir: 'test-output',
  timeout: 120000,      // 2 minutes per test
  workers: 1,           // Sequential execution
  retries: 0,
  viewport: { width: 1920, height: 1080 },
  screenshot: 'only-on-failure',
  trace: 'retain-on-failure'
}
```

## Running Tests

```bash
# Run all tests (builds first)
npm run test

# Run only E2E tests
npm run test -w tests

# Run specific test project
npx playwright test --project=base
npx playwright test --project=solution-server-tests

# Run specific test file
npx playwright test tests/e2e/tests/base/profile-management.test.ts

# Run with UI mode (interactive)
npx playwright test --ui

# Run in debug mode
npx playwright test --debug
```

## Test Utilities

### Key Test Files

- `tests/e2e/pages/` - Page Object Models
  - `base.page.ts` - Base page class
  - `configuration.page.ts` - Configuration interactions

- `tests/e2e/utilities/` - Test utilities
  - `vscode-commands.utils.ts` - VSCode command helpers
  - `file.utils.ts` - File manipulation
  - `logger.ts` - Test logging
  - `evaluation.utils.ts` - Solution evaluation

- `tests/e2e/fixtures/` - Test fixtures
  - `provider-configs.fixture.ts` - LLM provider configs
  - `test-repo-fixture.ts` - Test repository setup

### Enums

- `tests/e2e/enums/extension-types.enum.ts` - Extension types (core, java, etc.)
- `tests/e2e/enums/llm-providers.enum.ts` - LLM provider types
- `tests/e2e/enums/views.enum.ts` - UI view identifiers
- `tests/e2e/enums/fix-types.enum.ts` - Solution fix types

## Test Patterns

### Environment Setup

Tests use `.env` files for configuration:

```typescript
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, ".env") });
dotenv.config({ path: path.resolve(__dirname, ".env.ci") });
```

### Global Setup

**File**: `tests/global.setup.ts`

Runs before all tests to:

- Download test repositories
- Configure extensions
- Set up runtime assets

### Page Object Model

Tests use the Page Object pattern:

```typescript
import { BasePage } from "../pages/base.page";

test("should run analysis", async ({ page }) => {
  const basePage = new BasePage(page);
  await basePage.navigateTo("konveyor");
  await basePage.clickAnalyzeButton();
  await basePage.waitForAnalysisComplete();
});
```

## Unit Tests

Some workspaces have unit tests with Mocha:

```bash
# Shared workspace tests
npm run test -w shared

# Extension unit tests
npm run test:unit-tests -w vscode/core
```

### Example Unit Test (Mocha)

**File**: `shared/src/__tests__/labelSelector.test.ts`

```typescript
import { describe, it } from "mocha";
import { expect } from "expect";
import { labelSelector } from "../labelSelector";

describe("labelSelector", () => {
  it("should match simple label", () => {
    const result = labelSelector({ app: "test" }, "app=test");
    expect(result).toBe(true);
  });
});
```

## Kai Evaluator

Advanced testing for solution quality:

**Location**: `tests/kai-evaluator/`

Uses LangChain agents to evaluate:

- Solution correctness
- Code quality
- Build success
- Test coverage

```bash
npm run kai-evaluator
```

Components:

- `tests/kai-evaluator/agents/evaluation.agent.ts` - Evaluation agent
- `tests/kai-evaluator/chains/evaluation.chain.ts` - LangChain chain
- `tests/kai-evaluator/prompts/evaluation.prompt.ts` - Evaluation prompts

## MCP Client Testing

Tests for Model Context Protocol integration:

**Location**: `tests/mcp-client/`

- `mcp-client.model.ts` - MCP client model
- `mcp-client-responses.model.ts` - Response types

## Solution Server Auth Testing

Tests authentication with solution server:

**Location**: `tests/solution-server-auth/`

- `authentication-manager.ts` - Auth flow manager
- `utils.ts` - Auth utilities

## Test Data

Test data and fixtures are stored in:

- `tests/fixtures/` - Test data fixtures
- Downloaded test repos during global setup
- Mock LLM responses (for demo mode)

## CI/CD Testing

Tests run in CI with:

- GitHub Actions workflows
- Environment variables from `.env.ci`
- Automated extension packaging
- Result artifacts and traces

The `CI` environment variable enables stricter test mode:

```typescript
forbidOnly: !!process.env.CI;
```

## Debug Output

Test output locations:

- `tests/test-output/` - Test artifacts
- Screenshots on failure
- Trace files for debugging
- Console logs

View traces:

```bash
npx playwright show-trace tests/test-output/trace.zip
```
