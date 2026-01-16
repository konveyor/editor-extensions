# Test Categorization Guidelines

This document describes how to categorize and tag E2E tests in the Konveyor Editor Extensions project.

## Overview

Tests are categorized using Playwright tags to control when they run and whether they block PRs or releases. The categorization system uses **tier tags** to determine both the importance level and blocking behavior.

## Tag Format

Tags are specified using Playwright's `tag` option in `test.describe()`:

```typescript
test.describe("Test suite name", { tag: ["@tier0"] }, () => {
  // tests...
});
```

Or for multiple `test.describe()` blocks:

```typescript
providers.forEach((provider) => {
  test.describe(`Test ${provider.name}`, { tag: ["@tier1", "@slow"] }, () => {
    // tests...
  });
});
```

## Tag Categories

### Tier Tags (Required)

Every test suite must have exactly one tier tag indicating its importance and blocking behavior:

| Tag      | Description                                             | Blocks PRs | Blocks Releases | Typical Use Cases                                      |
| -------- | ------------------------------------------------------- | ---------- | --------------- | ------------------------------------------------------ |
| `@tier0` | **Critical** - Core functionality that must always work | ✅         | ✅              | Basic analysis, profile creation, extension activation |
| `@tier1` | **Important** - Production-critical features            | ❌         | ✅              | LLM fixes, solution server integration, major features |
| `@tier2` | **Nice-to-have** - Important but not blocking           | ❌         | ❌              | Custom binary analysis, advanced configurations        |
| `@tier3` | **Experimental** - Unstable or in-development tests     | ❌         | ❌              | New features being validated, flaky tests              |

### Environment Tags (Optional)

Optional tags indicating special infrastructure or runtime requirements:

| Tag                   | Description                                 | Example                         |
| --------------------- | ------------------------------------------- | ------------------------------- |
| `@requires-minikube`  | Needs Kubernetes cluster via Minikube       | Konveyor Hub integration tests  |
| `@requires-openshift` | Needs OpenShift cluster                     | OpenShift-specific features     |
| `@requires-cloud`     | Needs cloud resources                       | Tests requiring AWS/Azure/GCP   |
| `@slow`               | Long-running test (>5 minutes)              | Full migration scenarios        |
| `@offline`            | Uses cached/offline data, no real API calls | Tests with cached LLM responses |

## Tag Combinations

### Valid Combinations

Typical tag combinations and their behavior:

```typescript
// Critical test that blocks everything
{
  tag: ["@tier0"];
}
// Runs on: PRs ✅, Releases ✅ | Blocks: PRs ✅, Releases ✅

// Important test that only blocks releases
{
  tag: ["@tier1"];
}
// Runs on: PRs ✅, Releases ✅ | Blocks: PRs ❌, Releases ✅

// Nice-to-have test - never blocks
{
  tag: ["@tier2"];
}
// Runs on: PRs ✅, Releases ✅ | Blocks: PRs ❌, Releases ❌

// Experimental test - never blocks
{
  tag: ["@tier3"];
}
// Runs on: PRs ✅, Releases ✅ | Blocks: PRs ❌, Releases ❌

// Infrastructure test requiring minikube (skipped on PRs)
{
  tag: ["@tier1", "@requires-minikube"];
}
// Runs on: PRs ❌, Releases ✅ | Blocks: PRs ❌, Releases ✅

// Slow test (skipped on PRs)
{
  tag: ["@tier1", "@slow"];
}
// Runs on: PRs ❌, Releases ✅ | Blocks: PRs ❌, Releases ✅

// Offline test that must pass
{
  tag: ["@tier0", "@offline"];
}
// Runs on: PRs ✅, Releases ✅ | Blocks: PRs ✅, Releases ✅
```

### Invalid Combinations

Avoid these combinations as they don't make sense:

❌ `@offline` + `@requires-minikube` - Contradictory requirements
❌ `@tier0` + `@slow` - Critical tests should be fast for quick feedback

## Test Promotion Path

Tests should follow this maturation path:

```
@tier3
    ↓ (stable for 10+ consecutive runs)
@tier2
    ↓ (important + stable for 20+ consecutive runs)
@tier1
    ↓ (critical functionality + stable for 50+ consecutive runs + <2 min execution)
@tier0
```

### Promotion Criteria

**tier3 → tier2**

- Passes 10 consecutive runs
- No major refactoring expected
- Test intent is clear and valuable

**tier2 → tier1**

- Passes 20 consecutive runs
- Validates production-critical functionality
- Execution time < 5 minutes

**tier1 → tier0**

- Passes 50 consecutive runs
- Validates absolutely critical functionality
- Execution time < 2 minutes
- Team consensus required

## Examples

### Example 1: Core Functionality Test

```typescript
// tests/e2e/tests/base/configure-and-run-analysis.test.ts
test.describe.serial("Configure extension and run analysis", { tag: ["@tier0"] }, () => {
  // Tests for creating profiles, running analysis, etc.
  // This is critical functionality that must work before merging
});
```

### Example 2: Offline Cached Test

```typescript
// tests/e2e/tests/agent_flow_coolstore.test.ts
providers.forEach((config) => {
  test.describe(
    `Coolstore app tests with agent mode - ${config.provider}/${config.model}`,
    { tag: ["@tier0", "@offline"] },
    () => {
      // Uses cached LLM responses, no real API calls
      // Critical functionality validated without external dependencies
    },
  );
});
```

### Example 3: Important but Not Blocking PRs

```typescript
// tests/e2e/tests/base/llm-revert-check.test.ts
providers.forEach((provider) => {
  test.describe(`LLM Reversion tests | ${provider.model}`, { tag: ["@tier1"] }, () => {
    // Important for production but allowed to fail on PRs
    // Blocks releases to ensure quality
  });
});
```

### Example 4: Nice-to-Have Test

```typescript
// tests/e2e/tests/base/custom-binary-analysis.test.ts
test.describe.serial("Override the analyzer binary and run analysis", { tag: ["@tier2"] }, () => {
  // Nice to have validation but not critical
  // Failures don't block anything
});
```

### Example 5: Infrastructure Test

```typescript
// tests/e2e/tests/solution-server/settings.test.ts
test.describe("Solution Server settings", { tag: ["@tier1", "@requires-minikube"] }, () => {
  // Requires minikube cluster with Konveyor installed
  // Only runs on releases due to infrastructure cost
  // Blocks releases but not PRs
});
```

### Example 6: New Test Being Developed

```typescript
// tests/e2e/tests/experimental/new-feature.test.ts
test.describe("New experimental feature", { tag: ["@tier3"] }, () => {
  // Test for feature still under development
  // Never blocks, can be flaky
  // Will be promoted when stable
});
```

## CI/CD Integration

### How Tests Are Selected

The GitHub Actions workflow [.github/workflows/e2e-tests.yml](../.github/workflows/e2e-tests.yml) uses Playwright's `--grep` flag to select tests by tier:

**On PRs:**

```bash
# Critical tests (blocks PR) - excludes slow/infrastructure tests
npx playwright test --grep "@tier0" --grep-invert "@slow|@requires-minikube"

# Important tests (runs but doesn't block PR) - excludes slow/infrastructure tests
npx playwright test --grep "@tier1" --grep-invert "@slow|@requires-minikube"

# Nice-to-have tests (runs but doesn't block)
npx playwright test --grep "@tier2"

# Experimental tests (runs but doesn't block)
npx playwright test --grep "@tier3"
```

**On Releases:**

```bash
# All tier tests run, including @slow tests
# tier0 and tier1 tests BLOCK the release
# tier2 and tier3 tests run but don't block

# Infrastructure tests (blocks release)
npx playwright test --grep "@requires-minikube"
```

### Branch Protection

GitHub branch protection rules enforce:

**For `main` branch:**

- Required: `Critical Tests (@tier0)`

**For release tags:**

- Required: `Critical Tests (@tier0)`
- Required: `Important Tests (@tier1)`
- Required: `Infrastructure Tests (@requires-minikube)`

## FAQ

**Q: What if I don't know which tier to use?**
A: Start with `@tier3`. You can promote it later as it becomes more stable.

**Q: Can a test have multiple tier tags?**
A: No, use exactly one tier tag: `@tier0`, `@tier1`, `@tier2`, or `@tier3`.

**Q: How do I run only critical tests locally?**
A: `npx playwright test --grep "@tier0"`

**Q: How do I run all tests except experimental?**
A: `npx playwright test --grep-invert "@tier3"`

**Q: What if my test needs credentials but is @tier2 or @tier3?**
A: That's fine. The workflow passes credentials to all test tiers. tier2 and tier3 tests with credentials will run but won't block on failure.

**Q: Can I mix tags in the title string instead of using the tag option?**
A: While Playwright supports tags in titles (e.g., `test.describe('@tier0 My Test')`), we prefer the `tag` option for clarity and easier parsing.

**Q: How do I test infrastructure tests locally without minikube?**
A: Skip them with `npx playwright test --grep-invert "@requires-minikube"`

**Q: What happens if I forget to add tags?**
A: The PR validation check will fail, preventing the PR from being merged. Always add at least a tier tag to every `test.describe()` block.

## Monitoring and Metrics

Track test health using these metrics:

1. **Pass Rate**: `@tier0` tests should have >95% pass rate
2. **Execution Time**: `@tier0` tests should complete in <2 minutes
3. **Flakiness**: Any test failing >5% of runs should be demoted or fixed
4. **Coverage**: Ensure critical paths have `@tier0` tests

Review test categorization monthly and promote/demote as needed.

## Related Documentation

- [Playwright Test Annotations](https://playwright.dev/docs/test-annotations) - Official Playwright docs
- [GitHub Actions Workflow](../.github/workflows/e2e-tests.yml) - Implementation
- [GitHub Issue #1171](https://github.com/konveyor/editor-extensions/issues/1171) - Tracking issue
