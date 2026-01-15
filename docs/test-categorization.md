# Test Categorization Guidelines

This document describes how to categorize and tag E2E tests in the Konveyor Editor Extensions project.

## Overview

Tests are categorized using Playwright tags to control when they run and whether they block PRs or releases. The categorization system uses a combination of **tier tags** (importance level) and **gating tags** (blocking behavior).

## Tag Format

Tags are specified using Playwright's `tag` option in `test.describe()`:

```typescript
test.describe("Test suite name", { tag: ["@tier0", "@pr-gate"] }, () => {
  // tests...
});
```

Or for multiple `test.describe()` blocks:

```typescript
providers.forEach((provider) => {
  test.describe(`Test ${provider.name}`, { tag: ["@tier1", "@release-gate", "@slow"] }, () => {
    // tests...
  });
});
```

## Tag Categories

### Tier Tags (Required)

Every test suite must have exactly one tier tag indicating its importance:

| Tag      | Description                                             | Typical Use Cases                                      |
| -------- | ------------------------------------------------------- | ------------------------------------------------------ |
| `@tier0` | **Critical** - Core functionality that must always work | Basic analysis, profile creation, extension activation |
| `@tier1` | **Important** - Production-critical features            | LLM fixes, solution server integration, major features |
| `@tier2` | **Nice-to-have** - Important but not blocking           | Custom binary analysis, advanced configurations        |
| `@tier3` | **Experimental** - Unstable or in-development tests     | New features being validated, flaky tests              |

### Gating Tags (Required)

Every test suite must have exactly one gating tag indicating blocking behavior:

| Tag              | Description                  | Blocks PRs | Blocks Releases | When to Use                                        |
| ---------------- | ---------------------------- | ---------- | --------------- | -------------------------------------------------- |
| `@pr-gate`       | Blocks both PRs and releases | ✅         | ✅              | Critical functionality that must pass before merge |
| `@release-gate`  | Blocks only releases         | ❌         | ✅              | Important features for production                  |
| `@informational` | Never blocks                 | ❌         | ❌              | Nice-to-have validation, unstable tests            |
| `@experimental`  | Never blocks, rarely runs    | ❌         | ❌              | Tests being developed or known to be flaky         |

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
  tag: ["@tier0", "@pr-gate"];
}
// Runs on: PRs ✅, Releases ✅ | Blocks: PRs ✅, Releases ✅

// Important test that only blocks releases
{
  tag: ["@tier1", "@release-gate"];
}
// Runs on: PRs ✅, Releases ✅ | Blocks: PRs ❌, Releases ✅

// Informational test
{
  tag: ["@tier2", "@informational"];
}
// Runs on: PRs ✅, Releases ✅ | Blocks: PRs ❌, Releases ❌

// Experimental test with special requirements
{
  tag: ["@tier3", "@experimental", "@requires-minikube"];
}
// Runs on: PRs ❌, Releases ✅ | Blocks: PRs ❌, Releases ❌

// Slow test that gates releases
{
  tag: ["@tier1", "@release-gate", "@slow"];
}
// Runs on: PRs ❌, Releases ✅ | Blocks: PRs ❌, Releases ✅

// Offline test that must pass
{
  tag: ["@tier0", "@pr-gate", "@offline"];
}
// Runs on: PRs ✅, Releases ✅ | Blocks: PRs ✅, Releases ✅
```

### Invalid Combinations

Avoid these combinations as they don't make sense:

❌ `@tier0` + `@experimental` - Critical tests should not be experimental
❌ `@tier3` + `@pr-gate` - Experimental tests should never block PRs
❌ `@offline` + `@requires-minikube` - Contradictory requirements

## Test Promotion Path

Tests should follow this maturation path:

```
@tier3 @experimental
    ↓ (stable for 10+ consecutive runs)
@tier2 @informational
    ↓ (important + stable for 20+ consecutive runs)
@tier1 @release-gate
    ↓ (critical functionality + stable for 50+ consecutive runs + <2 min execution)
@tier0 @pr-gate
```

### Promotion Criteria

**Experimental → Informational**

- Passes 10 consecutive runs
- No major refactoring expected
- Test intent is clear and valuable

**Informational → Release Gate**

- Passes 20 consecutive runs
- Validates production-critical functionality
- Execution time < 5 minutes

**Release Gate → PR Gate**

- Passes 50 consecutive runs
- Validates absolutely critical functionality
- Execution time < 2 minutes
- Team consensus required

## Examples

### Example 1: Core Functionality Test

```typescript
// tests/e2e/tests/base/configure-and-run-analysis.test.ts
test.describe.serial("Configure extension and run analysis", { tag: ["@tier0", "@pr-gate"] }, () => {
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
    { tag: ["@tier0", "@pr-gate", "@offline"] },
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
  test.describe(`LLM Reversion tests | ${provider.model}`, { tag: ["@tier1", "@release-gate"] }, () => {
    // Important for production but allowed to fail on PRs
    // Blocks releases to ensure quality
  });
});
```

### Example 4: Informational Test

```typescript
// tests/e2e/tests/base/custom-binary-analysis.test.ts
test.describe.serial("Override the analyzer binary and run analysis", { tag: ["@tier2", "@informational"] }, () => {
  // Nice to have validation but not critical
  // Failures don't block anything
});
```

### Example 5: Infrastructure Test

```typescript
// tests/e2e/tests/infrastructure/konveyor-hub.test.ts
test.describe("Konveyor Hub Integration", { tag: ["@tier1", "@release-gate", "@requires-minikube", "@slow"] }, () => {
  // Requires minikube cluster with Konveyor installed
  // Only runs on releases due to infrastructure cost
  // Blocks releases but not PRs
});
```

### Example 6: New Test Being Developed

```typescript
// tests/e2e/tests/experimental/new-feature.test.ts
test.describe("New experimental feature", { tag: ["@tier3", "@experimental"] }, () => {
  // Test for feature still under development
  // Runs only on release builds, never blocks
  // Will be promoted when stable
});
```

## CI/CD Integration

### How Tests Are Selected

The GitHub Actions workflow [.github/workflows/e2e-tests.yml](../.github/workflows/e2e-tests.yml) uses Playwright's `--grep` flag to select tests:

**On PRs:**

```bash
# Critical tests (blocks PR)
npx playwright test --grep "@tier0.*@pr-gate"

# Release gate tests (runs but doesn't block)
npx playwright test --grep "@tier1.*@release-gate"

# Informational tests (runs but doesn't block)
npx playwright test --grep "@tier2.*@informational"
```

**On Releases:**

```bash
# All above tests PLUS infrastructure tests (all block release)
npx playwright test --grep "@requires-minikube"
npx playwright test --grep "@tier3.*@experimental"  # runs but doesn't block
```

### Branch Protection

GitHub branch protection rules enforce:

**For `main` branch:**

- Required: `Critical Tests (@tier0 @pr-gate)`

**For release tags:**

- Required: `Critical Tests (@tier0 @pr-gate)`
- Required: `Release Gate Tests (@tier1 @release-gate)`
- Required: `Infrastructure Tests (@requires-minikube)`

## FAQ

**Q: What if I don't know which tier to use?**
A: Start with `@tier3 @experimental`. You can promote it later.

**Q: Can a test have multiple gating tags?**
A: No, use exactly one: `@pr-gate`, `@release-gate`, `@informational`, or `@experimental`.

**Q: How do I run only critical tests locally?**
A: `npx playwright test --grep "@tier0.*@pr-gate"`

**Q: How do I run all tests except experimental?**
A: `npx playwright test --grep-invert "@experimental"`

**Q: What if my test needs credentials but is @informational?**
A: That's fine. The workflow passes credentials to all tests. Informational tests with credentials will run but won't block on failure.

**Q: Can I mix tags in the title string instead of using the tag option?**
A: While Playwright supports tags in titles (e.g., `test.describe('@tier0 @pr-gate My Test')`), we prefer the `tag` option for clarity and easier parsing.

**Q: How do I test infrastructure tests locally without minikube?**
A: Skip them with `npx playwright test --grep-invert "@requires-minikube"`

**Q: What happens if I forget to add tags?**
A: Untagged tests won't be selected by the CI grep patterns and won't run in CI. Always add at least a tier and gating tag.

## Monitoring and Metrics

Track test health using these metrics:

1. **Pass Rate**: `@pr-gate` tests should have >95% pass rate
2. **Execution Time**: `@pr-gate` tests should complete in <2 minutes
3. **Flakiness**: Any test failing >5% of runs should be demoted or fixed
4. **Coverage**: Ensure critical paths have `@tier0 @pr-gate` tests

Review test categorization monthly and promote/demote as needed.

## Related Documentation

- [Enhancement Proposal](./enhancement-flexible-e2e-test-gating.md) - Full technical design
- [Playwright Test Annotations](https://playwright.dev/docs/test-annotations) - Official Playwright docs
- [GitHub Actions Workflow](../.github/workflows/e2e-tests.yml) - Implementation
- [GitHub Issue #1171](https://github.com/konveyor/editor-extensions/issues/1171) - Tracking issue
