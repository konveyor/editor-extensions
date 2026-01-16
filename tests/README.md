# VSCode Automation with Playwright

This module contains automated tests using Playwright to launch VSCode, install the extension and
perform a series of e2e tests

## Table of Contents

- [Features](#features)
- [Test Categorization](#test-categorization)
- [Getting Started](#-getting-started)

# Features

Features already automated in this repo:

## General

- Install extension from vsix
- Configure GenAI Provider
- Create and manage analysis profiles
- Start server
- Open and analyze application
- Search for violations
- Fix Issues using default effort
- Accept proposed solutions
- Evaluation: [kai-evaluator](kai-evaluator)

## Solution Server

- [analysis-validation.test.ts](e2e/tests/solution-server/analysis-validation.test.ts)[solution-server-analysis-validation.test.ts](e2e/tests/solution-server/solution-server-analysis-validation.test.ts):
  Tests the process of requesting, accepting, and rejecting solutions, and verifies that the
  solution server's success rate and best hints endpoints are updated accordingly.

# Test Categorization

Tests are organized using tags that control when they run and whether they block PRs or releases.

## Quick Reference

Every test must have a **tier tag** that determines its blocking behavior.

### Tier Tags (Required - Pick One)

| Tag      | Runs on PRs | Blocks PRs | Runs on Releases | Blocks Releases | Use For                              |
|----------|-------------|------------|------------------|-----------------|--------------------------------------|
| `@tier0` | ✅          | ✅         | ✅               | ✅              | Critical functionality               |
| `@tier1` | ✅          | ❌         | ✅               | ✅              | Important production features        |
| `@tier2` | ✅          | ❌         | ✅               | ❌              | Nice-to-have, stable validation      |
| `@tier3` | ✅          | ❌         | ✅               | ❌              | Experimental/flaky tests             |

**Key Points:**
- `@tier0` = Highest bar, blocks everything
- `@tier1` = Production-critical, blocks releases only
- `@tier2` = Stable but not critical, never blocks
- `@tier3` = Unstable/flaky, never blocks

### Environment Tags (Optional)

| Tag                  | Effect                                        |
|----------------------|-----------------------------------------------|
| `@requires-minikube` | Skipped on PRs, runs only on releases         |
| `@slow`              | Skipped on PRs, runs only on releases         |
| `@offline`           | Uses cached data, no real API calls           |

## How to Tag Tests

Use Playwright's `tag` option in `test.describe()`:

```typescript
test.describe('My test suite', { tag: ['@tier0'] }, () => {
  test('should do something', async () => {
    // test code
  });
});
```

## Examples

```typescript
// Critical test that blocks PRs and releases
test.describe('Configure and run analysis', { tag: ['@tier0'] }, () => {
  // ...
});

// Important test that only blocks releases
test.describe('LLM reversion tests', { tag: ['@tier1'] }, () => {
  // ...
});

// Test with cached data (no real API calls) - still critical
test.describe('Agent flow', { tag: ['@tier0', '@offline'] }, () => {
  // ...
});

// Infrastructure test - blocks releases, skipped on PRs
test.describe('Konveyor Hub integration', { tag: ['@tier1', '@requires-minikube'] }, () => {
  // ...
});

// Slow test - blocks releases, skipped on PRs
test.describe('Full migration scenario', { tag: ['@tier1', '@slow'] }, () => {
  // ...
});

// Nice-to-have test - never blocks
test.describe('Custom binary analysis', { tag: ['@tier2'] }, () => {
  // ...
});

// Experimental/flaky test - never blocks
test.describe('New feature being validated', { tag: ['@tier3'] }, () => {
  // ...
});
```

## Running Tests Locally

```bash
# Run only critical tests (blocks PRs)
npx playwright test --grep "@tier0"

# Run all release-blocking tests
npx playwright test --grep "@tier0|@tier1"

# Run all tests except experimental
npx playwright test --grep-invert "@tier3"

# Run all tests except slow/infrastructure tests
npx playwright test --grep-invert "@slow|@requires-minikube"

# Run specific tier
npx playwright test --grep "@tier1"
```

## Full Documentation

For complete guidelines including promotion criteria, tag combinations, and CI/CD integration, see:
- **[Test Categorization Guidelines](../docs/test-categorization.md)** - Complete reference

# 🚀 Getting Started

To get started, check out the E2E environment setup
guide: [e2e-environment.md](docs/contrib/e2e-environment.md)


