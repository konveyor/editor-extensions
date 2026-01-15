# Enhancement: Flexible E2E Test Gating System

**Status:** Proposal
**Created:** 2026-01-13
**Author:** Engineering Team
**Implementation:** Single PR (all-at-once)

## Executive Summary

This enhancement proposes a flexible test gating system that allows E2E tests to be categorized and selectively gate different stages of the development lifecycle (PR merge, releases, or run informational-only). The system leverages Playwright's tag-based test organization and GitHub Actions' job orchestration to provide granular control over which tests block which processes.

## Problem Statement

Currently, E2E tests in [ci-repo.yml:387-403](../.github/workflows/ci-repo.yml#L387-L403) run only two specific hardcoded tests that block the entire CI/CD pipeline including PRs and releases. This creates several challenges:

1. **Binary gating**: Tests either block everything or block nothing
2. **Difficulty adding new tests**: New tests must be stable enough to gate releases immediately
3. **No progressive testing**: Cannot graduate tests from informational → PR gate → release gate
4. **Limited scalability**: As tests grow, all tests must maintain the same quality bar
5. **Complex setup requirements**: Tests requiring different infrastructure (e.g., minikube + Konveyor) cannot be easily integrated

## Goals

1. Enable tests to gate PRs, releases, both, or neither
2. Support progressive test maturation (experimental → stable → critical)
3. Allow tests with different infrastructure requirements to coexist
4. Maintain clear visibility into test status and blocking behavior
5. Preserve fast feedback loops for developers
6. Implement in a single PR for atomic deployment

## Non-Goals

- Replacing the existing test infrastructure
- Removing any currently working tests
- Creating a complex test orchestration framework
- Immediate migration of all tests (tagging happens progressively)

## Current State Analysis

### Existing Test Organization

From [playwright.config.ts](../tests/playwright.config.ts):

- **base** project: Core functionality tests ([tests/e2e/tests/base/](../tests/e2e/tests/base/))
- **solution-server-tests** project: Server-specific tests ([tests/e2e/tests/solution-server/](../tests/e2e/tests/solution-server/))
- **analysis-tests** project: Tests matching `/.*analyze.+\.test\.ts/`
- **agent-flow-tests** project: Tests matching `/.*agent_flow.+\.test\.ts/`

### Existing Tag System

Already in use (but not leveraged in CI):

- `@tier0` - Critical tests (e.g., [fix-one-issue.test.ts:15](../tests/e2e/tests/base/fix-one-issue.test.ts#L15))
- `@tier1` - Important tests (e.g., [llm-revert-check.test.ts:21](../tests/e2e/tests/base/llm-revert-check.test.ts#L21))
- `@tier2` - Secondary tests (e.g., [custom-binary-analysis.test.ts:17](../tests/e2e/tests/base/custom-binary-analysis.test.ts#L17))

### Currently Running Tests

From [ci-repo.yml:387-403](../.github/workflows/ci-repo.yml#L387-L403):

1. `e2e/tests/base/configure-and-run-analysis.test.ts` - with credentials
2. `e2e/tests/agent_flow_coolstore.test.ts` - offline mode, no credentials

Both tests **block** PRs and releases.

## Proposed Solution

### 1. Enhanced Test Categorization System

Extend the existing tier system with gating behavior and infrastructure tags:

```typescript
// Format: @tier{N} @{gating-behavior} [@{environment}]

// Critical tests that must pass for PRs to merge
test.describe("@tier0 @pr-gate Configure and run analysis", () => {
  // Core functionality tests
});

// Important tests that gate releases but not PRs
test.describe("@tier1 @release-gate Solution server validation", () => {
  // Production-critical features
});

// Tests that run but never block
test.describe("@tier2 @informational Experimental AI features", () => {
  // Nice-to-have validation
});

// Tests requiring complex infrastructure
test.describe("@tier1 @release-gate @requires-minikube Konveyor Hub integration", () => {
  // Integration tests with Kubernetes
});
```

#### Complete Tag Reference

| Tag                     | Meaning                 | Blocks PRs      | Blocks Releases | Run on PR | Run on Release |
| ----------------------- | ----------------------- | --------------- | --------------- | --------- | -------------- |
| `@tier0 @pr-gate`       | Critical functionality  | ✅              | ✅              | ✅        | ✅             |
| `@tier1 @release-gate`  | Important features      | ❌              | ✅              | ✅        | ✅             |
| `@tier2 @informational` | Nice-to-have            | ❌              | ❌              | ✅        | ✅             |
| `@tier3 @experimental`  | Unstable/in-development | ❌              | ❌              | ❌        | ✅             |
| `@requires-minikube`    | Needs Kubernetes        | Depends on tier | Depends on tier | ❌        | ✅             |
| `@requires-openshift`   | Needs OpenShift         | Depends on tier | Depends on tier | ❌        | ✅             |
| `@slow`                 | Execution >5 min        | Depends on tier | Depends on tier | ❌        | ✅             |
| `@offline`              | Uses cached data        | N/A             | N/A             | ✅        | ✅             |

### 2. New GitHub Actions Workflow Structure

Create a new modular workflow that replaces the current `test-e2e` job.

#### File Structure

```
.github/
├── workflows/
│   ├── ci-repo.yml (modified)
│   └── e2e-tests.yml (new)
└── actions/
    └── setup-test-environment/
        └── action.yml (new)
```

#### New Workflow: `.github/workflows/e2e-tests.yml`

```yaml
name: E2E Tests

on:
  workflow_call:
    inputs:
      vsix_artifact_name:
        required: true
        type: string
      trigger_context:
        required: true
        type: string # 'pr', 'release', 'manual'
    secrets:
      OPENAI_API_KEY:
        required: false

jobs:
  # Shared setup for all test jobs
  setup:
    name: Setup Test Environment
    runs-on: ubuntu-latest
    outputs:
      core_vsix: ${{ steps.set_vsix_paths.outputs.core_vsix }}
      java_vsix: ${{ steps.set_vsix_paths.outputs.java_vsix }}
      javascript_vsix: ${{ steps.set_vsix_paths.outputs.javascript_vsix }}
      go_vsix: ${{ steps.set_vsix_paths.outputs.go_vsix }}
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version-file: ".nvmrc"
          cache: "npm"

      - name: Download VSIX artifacts
        uses: actions/download-artifact@v4
        with:
          name: ${{ inputs.vsix_artifact_name }}
          path: ./dist

      - name: Set VSIX paths
        id: set_vsix_paths
        run: |
          # Read extension names from package.json files
          CORE_NAME=$(node -p "require('./vscode/core/package.json').name")
          JAVA_NAME=$(node -p "require('./vscode/java/package.json').name")
          JS_NAME=$(node -p "require('./vscode/javascript/package.json').name")
          GO_NAME=$(node -p "require('./vscode/go/package.json').name")

          # Find the actual VSIX files
          CORE_VSIX=$(ls ./dist/${CORE_NAME}-*.vsix | head -n 1)
          JAVA_VSIX=$(ls ./dist/${JAVA_NAME}-*.vsix | head -n 1)
          JS_VSIX=$(ls ./dist/${JS_NAME}-*.vsix | head -n 1)
          GO_VSIX=$(ls ./dist/${GO_NAME}-*.vsix | head -n 1)

          # Verify and output
          for vsix in "$CORE_VSIX" "$JAVA_VSIX" "$JS_VSIX" "$GO_VSIX"; do
            [ ! -f "$vsix" ] && echo "Error: VSIX not found: $vsix" && exit 1
          done

          echo "core_vsix=${CORE_VSIX}" >> $GITHUB_OUTPUT
          echo "java_vsix=${JAVA_VSIX}" >> $GITHUB_OUTPUT
          echo "javascript_vsix=${JS_VSIX}" >> $GITHUB_OUTPUT
          echo "go_vsix=${GO_VSIX}" >> $GITHUB_OUTPUT

  # Critical tests - block PRs and releases
  test-critical:
    name: Critical Tests (@tier0 @pr-gate)
    runs-on: ubuntu-latest
    needs: setup
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup test environment
        uses: ./.github/actions/setup-test-environment

      - name: Download VSIX artifacts
        uses: actions/download-artifact@v4
        with:
          name: ${{ inputs.vsix_artifact_name }}
          path: ./dist

      - name: Run critical tests
        run: npx playwright test --grep "@tier0.*@pr-gate"
        working-directory: ./tests
        env:
          __TEST_EXTENSION_END_TO_END__: "true"
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          CORE_VSIX_FILE_PATH: ${{ github.workspace }}/${{ needs.setup.outputs.core_vsix }}
          JAVA_VSIX_FILE_PATH: ${{ github.workspace }}/${{ needs.setup.outputs.java_vsix }}

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: critical-test-results
          path: tests/test-output/
          retention-days: 7

  # Release gate tests - block releases only
  test-release-gate:
    name: Release Gate Tests (@tier1 @release-gate)
    runs-on: ubuntu-latest
    needs: setup
    # Only required for releases, but run on PRs for visibility
    continue-on-error: ${{ inputs.trigger_context == 'pr' }}
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup test environment
        uses: ./.github/actions/setup-test-environment

      - name: Download VSIX artifacts
        uses: actions/download-artifact@v4
        with:
          name: ${{ inputs.vsix_artifact_name }}
          path: ./dist

      - name: Run release gate tests (no infrastructure)
        run: npx playwright test --grep "@tier1.*@release-gate" --grep-invert "@requires-"
        working-directory: ./tests
        env:
          __TEST_EXTENSION_END_TO_END__: "true"
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          CORE_VSIX_FILE_PATH: ${{ github.workspace }}/${{ needs.setup.outputs.core_vsix }}
          JAVA_VSIX_FILE_PATH: ${{ github.workspace }}/${{ needs.setup.outputs.java_vsix }}

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: release-gate-test-results
          path: tests/test-output/
          retention-days: 7

  # Infrastructure tests - requires minikube + Konveyor
  test-infrastructure:
    name: Infrastructure Tests (@requires-minikube)
    runs-on: ubuntu-latest
    needs: setup
    # Only run on releases
    if: inputs.trigger_context == 'release'
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup test environment
        uses: ./.github/actions/setup-test-environment

      - name: Download VSIX artifacts
        uses: actions/download-artifact@v4
        with:
          name: ${{ inputs.vsix_artifact_name }}
          path: ./dist

      # Use existing reusable action/workflow for minikube + Konveyor setup
      # NOTE: This would reference konveyor/konveyor or similar repo's reusable workflow
      - name: Setup Minikube with Konveyor
        uses: konveyor/konveyor/.github/actions/setup-minikube@main
        # OR if it's a reusable workflow:
        # uses: konveyor/konveyor/.github/workflows/setup-test-env.yml@main
        with:
          kubernetes-version: v1.28.0

      - name: Run infrastructure tests
        run: npx playwright test --grep "@requires-minikube"
        working-directory: ./tests
        env:
          __TEST_EXTENSION_END_TO_END__: "true"
          CORE_VSIX_FILE_PATH: ${{ github.workspace }}/${{ needs.setup.outputs.core_vsix }}
          JAVA_VSIX_FILE_PATH: ${{ github.workspace }}/${{ needs.setup.outputs.java_vsix }}
          KONVEYOR_HUB_URL: ${{ steps.setup-konveyor.outputs.hub-url }}

      - name: Collect infrastructure logs
        if: always()
        run: |
          mkdir -p tests/test-output/k8s-logs
          kubectl logs -n konveyor -l app=konveyor-hub --tail=1000 > tests/test-output/k8s-logs/hub.log || true
          kubectl describe pods -n konveyor > tests/test-output/k8s-logs/pods.txt || true

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: infrastructure-test-results
          path: tests/test-output/
          retention-days: 7

  # Informational tests - never block
  test-informational:
    name: Informational Tests (@tier2 @informational)
    runs-on: ubuntu-latest
    needs: setup
    continue-on-error: true
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup test environment
        uses: ./.github/actions/setup-test-environment

      - name: Download VSIX artifacts
        uses: actions/download-artifact@v4
        with:
          name: ${{ inputs.vsix_artifact_name }}
          path: ./dist

      - name: Run informational tests
        id: informational_tests
        run: npx playwright test --grep "@tier2.*@informational"
        working-directory: ./tests
        continue-on-error: true
        env:
          __TEST_EXTENSION_END_TO_END__: "true"
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          CORE_VSIX_FILE_PATH: ${{ github.workspace }}/${{ needs.setup.outputs.core_vsix }}
          JAVA_VSIX_FILE_PATH: ${{ github.workspace }}/${{ needs.setup.outputs.java_vsix }}

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: informational-test-results
          path: tests/test-output/
          retention-days: 7

      - name: Comment PR with informational results
        if: always() && github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const outcome = '${{ steps.informational_tests.outcome }}';
            const emoji = outcome === 'success' ? '✅' : '⚠️';
            const status = outcome === 'success' ? 'passed' : 'failed';
            const blocking = outcome === 'success' ? '' : ' (not blocking merge)';

            const comment = `${emoji} **Informational Tests ${status}${blocking}**

            These tests provide additional validation but do not block merging.

            📊 [View detailed results](https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }})`;

            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: comment
            });

  # Experimental tests - only on releases
  test-experimental:
    name: Experimental Tests (@tier3 @experimental)
    runs-on: ubuntu-latest
    needs: setup
    continue-on-error: true
    if: inputs.trigger_context == 'release'
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup test environment
        uses: ./.github/actions/setup-test-environment

      - name: Download VSIX artifacts
        uses: actions/download-artifact@v4
        with:
          name: ${{ inputs.vsix_artifact_name }}
          path: ./dist

      - name: Run experimental tests
        run: npx playwright test --grep "@tier3.*@experimental"
        working-directory: ./tests
        continue-on-error: true
        env:
          __TEST_EXTENSION_END_TO_END__: "true"
          CORE_VSIX_FILE_PATH: ${{ github.workspace }}/${{ needs.setup.outputs.core_vsix }}
          JAVA_VSIX_FILE_PATH: ${{ github.workspace }}/${{ needs.setup.outputs.java_vsix }}

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: experimental-test-results
          path: tests/test-output/
          retention-days: 7

  # Summary job
  test-summary:
    name: Test Summary
    runs-on: ubuntu-latest
    needs: [test-critical, test-release-gate, test-infrastructure, test-informational]
    if: always()
    steps:
      - name: Generate summary
        run: |
          cat >> $GITHUB_STEP_SUMMARY << 'EOF'
          ## E2E Test Results Summary

          | Category | Status | Blocks PRs | Blocks Releases |
          |----------|--------|------------|-----------------|
          | Critical (@tier0) | ${{ needs.test-critical.result }} | ✅ | ✅ |
          | Release Gate (@tier1) | ${{ needs.test-release-gate.result }} | ❌ | ✅ |
          | Infrastructure | ${{ needs.test-infrastructure.result }} | ❌ | ✅ |
          | Informational (@tier2) | ${{ needs.test-informational.result }} | ❌ | ❌ |

          **Context:** ${{ inputs.trigger_context }}
          **Triggered by:** ${{ github.event_name }}

          📊 [Full workflow run](https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }})
          EOF
```

#### New Composite Action: `.github/actions/setup-test-environment/action.yml`

```yaml
name: "Setup E2E Test Environment"
description: "Sets up the common environment for E2E tests"
runs:
  using: "composite"
  steps:
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version-file: ".nvmrc"
        cache: "npm"

    - name: Install VSCode dependencies
      shell: bash
      run: sudo apt-get update && sudo apt-get install -y wget

    - name: Setup Java
      uses: actions/setup-java@v4
      with:
        distribution: "oracle"
        java-version: "17"

    - name: Setup Go
      uses: actions/setup-go@v5
      with:
        go-version: "1.23"

    - name: Download and Install VSCode
      shell: bash
      run: |
        wget -qO- https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > packages.microsoft.gpg
        sudo install -D -o root -g root -m 644 packages.microsoft.gpg /etc/apt/keyrings/packages.microsoft.gpg
        echo "deb [arch=amd64,arm64,armhf signed-by=/etc/apt/keyrings/packages.microsoft.gpg] https://packages.microsoft.com/repos/code stable main" |sudo tee /etc/apt/sources.list.d/vscode.list > /dev/null
        rm -f packages.microsoft.gpg
        sudo apt install apt-transport-https -y
        sudo apt update
        sudo apt install code -y

    - name: Set up virtual X11
      shell: bash
      run: |
        sudo apt-get install -y \
          xvfb x11-xserver-utils dbus-x11 \
          xfonts-100dpi xfonts-75dpi libxrender1 \
          libxext6 libx11-6 xfonts-base \
          nickle cairo-5c xorg-docs-core

    - name: Set DISPLAY environment variable
      shell: bash
      run: |
        Xvfb :99 -screen 0 1920x1080x24 &
        echo "DISPLAY=:99" >> "$GITHUB_ENV"

    - name: Start Dbus
      shell: bash
      run: |
        dbus-launch --exit-with-session &
        sudo service dbus start
        export XDG_RUNTIME_DIR=/run/user/$(id -u)
        sudo chmod 700 $XDG_RUNTIME_DIR
        sudo chown $(id -un):$(id -gn) $XDG_RUNTIME_DIR
        export DBUS_SESSION_BUS_ADDRESS=unix:path=$XDG_RUNTIME_DIR/bus
        dbus-daemon --session --address=$DBUS_SESSION_BUS_ADDRESS --nofork --nopidfile --syslog-only &
        mkdir -p ~/.vscode && echo '{ "disable-hardware-acceleration": true }' > ~/.vscode/argv.json

    - name: Verify Installation
      shell: bash
      run: code --version

    - name: Ensure no VSCode instances are running
      shell: bash
      run: pkill -f code || true

    - name: Install test dependencies
      shell: bash
      run: npm ci
      working-directory: ./tests
```

### 3. Modify Existing ci-repo.yml

Replace the current `test-e2e` job ([lines 252-436](../.github/workflows/ci-repo.yml#L252-L436)):

```yaml
# .github/workflows/ci-repo.yml

# Replace existing test-e2e job with:
test-e2e:
  name: E2E Tests
  needs: package
  uses: ./.github/workflows/e2e-tests.yml
  with:
    vsix_artifact_name: "vsix-artifacts"
    trigger_context: ${{ github.event_name == 'pull_request' && 'pr' || startsWith(github.ref, 'refs/tags/v') && 'release' || 'manual' }}
  secrets:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}

# Rest of the workflow remains unchanged
publish:
  name: Publish Development Build
  runs-on: ubuntu-latest
  needs: test-e2e
  # ... existing publish job
```

### 4. Initial Test Tagging

Tag the currently running tests to maintain existing behavior:

```diff
# tests/e2e/tests/base/configure-and-run-analysis.test.ts
-test.describe.serial(`Configure extension and run analysis`, () => {
+test.describe.serial('@tier0 @pr-gate Configure extension and run analysis', () => {
   // ... tests
 });
```

```diff
# tests/e2e/tests/agent_flow_coolstore.test.ts
-test.describe(`Coolstore app tests with agent mode enabled - offline (cached) | ${config.provider}/${config.model}`, () => {
+test.describe('@tier0 @pr-gate @offline Coolstore app tests with agent mode enabled - offline (cached) | ${config.provider}/${config.model}', () => {
   // ... tests
 });
```

### 5. Branch Protection Configuration

Update GitHub branch protection rules to require new jobs:

**For `main` branch:**

- Required status checks:
  - `Critical Tests (@tier0 @pr-gate)`

**For `release-*` branches:**

- Required status checks:
  - `Critical Tests (@tier0 @pr-gate)`
  - `Release Gate Tests (@tier1 @release-gate)`
  - `Infrastructure Tests (@requires-minikube)`

## Handling Complex Infrastructure

### Leveraging Existing Reusable Actions

The implementation assumes Konveyor organization has reusable workflows/actions for infrastructure setup. Reference them like:

```yaml
- name: Setup Minikube with Konveyor
  uses: konveyor/konveyor/.github/actions/setup-minikube@main
  # OR
  # uses: konveyor/konveyor/.github/workflows/setup-test-env.yml@main
```

### Playwright Fixtures for Infrastructure

For local development and test isolation, create fixtures:

```typescript
// tests/e2e/fixtures/minikube-fixture.ts
import { test as base } from "@playwright/test";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

type InfrastructureFixtures = {
  konveyorUrl: string;
};

export const test = base.extend<InfrastructureFixtures>({
  konveyorUrl: async ({}, use, testInfo) => {
    // Check if running in CI with pre-configured infrastructure
    if (process.env.KONVEYOR_HUB_URL) {
      await use(process.env.KONVEYOR_HUB_URL);
      return;
    }

    // Local development: start minikube
    console.log("Setting up local minikube for development...");
    await execAsync("minikube start --kubernetes-version=v1.28.0");
    await execAsync("kubectl apply -f https://raw.githubusercontent.com/konveyor/operator/main/install.yaml");
    await execAsync("kubectl wait --for=condition=available deployment/konveyor-operator -n konveyor --timeout=600s");

    const { stdout: url } = await execAsync("minikube service konveyor-hub -n konveyor --url");

    await use(url.trim());

    // Cleanup on test failure
    if (testInfo.status !== "passed") {
      const { stdout: logs } = await execAsync("kubectl logs -n konveyor -l app=konveyor-hub --tail=100");
      console.log("Konveyor logs:", logs);
    }
  },
});
```

Usage:

```typescript
// tests/e2e/tests/infrastructure/konveyor-hub.test.ts
import { test } from "../../fixtures/minikube-fixture";
import { expect } from "@playwright/test";

test.describe("@tier1 @release-gate @requires-minikube Konveyor Hub Integration", () => {
  test("should connect to Konveyor Hub", async ({ konveyorUrl, page }) => {
    await page.goto(`${konveyorUrl}/applications`);
    await expect(page).toHaveTitle(/Konveyor/);
  });
});
```

## Implementation Checklist

This is a single-PR implementation. All items should be completed before merging:

### Core Files

- [ ] Create `.github/workflows/e2e-tests.yml`
- [ ] Create `.github/actions/setup-test-environment/action.yml`
- [ ] Modify `.github/workflows/ci-repo.yml` (replace test-e2e job)

### Test Tagging

- [ ] Tag `configure-and-run-analysis.test.ts` as `@tier0 @pr-gate`
- [ ] Tag `agent_flow_coolstore.test.ts` as `@tier0 @pr-gate @offline`
- [ ] Tag existing `@tier0`, `@tier1`, `@tier2` tests with gating behavior
- [ ] Add environment tags (`@requires-minikube`, etc.) where applicable

### Infrastructure

- [ ] Create minikube fixture ([tests/e2e/fixtures/minikube-fixture.ts](../tests/e2e/fixtures/minikube-fixture.ts))
- [ ] Verify reusable Konveyor setup action exists or create fallback
- [ ] Test infrastructure job locally with minikube

### Documentation

- [ ] Add this enhancement document to [docs/](../docs/)
- [ ] Create test categorization guidelines ([docs/test-categorization.md](../docs/test-categorization.md))
- [ ] Update [tests/README.md](../tests/README.md) with tag usage

### Testing

- [ ] Test workflow locally with [act](https://github.com/nektos/act) or similar
- [ ] Test on a feature branch with all job types
- [ ] Verify PR gating works (critical tests block, informational don't)
- [ ] Verify release gating works (release-gate tests block releases)

### Configuration

- [ ] Update branch protection rules for `main`
- [ ] Update branch protection rules for `release-*` branches
- [ ] Configure required status checks

## Rollback Plan

If issues arise post-merge:

1. **Immediate rollback**: Revert the PR completely

   ```bash
   git revert <PR-merge-commit>
   ```

2. **Partial rollback**: Keep new structure but make all jobs non-blocking

   ```yaml
   # In e2e-tests.yml, add to all jobs:
   continue-on-error: true
   ```

3. **Branch protection**: Remove new required checks, restore old ones

## Success Metrics

After deployment, track:

1. **Test Stability**: % of tests passing consistently
   - Target: >95% for `@pr-gate` tests
   - Target: >90% for `@release-gate` tests

2. **CI Time**: Average time for PR builds
   - Target: <30 minutes for PR builds
   - Target: <60 minutes for release builds

3. **False Positives**: # of tests incorrectly blocking
   - Target: <5% per month

4. **Test Coverage Growth**: # of new tests added per month
   - Target: +10% test coverage per quarter

## Future Enhancements

After successful deployment, consider:

1. **Test result trending** - Track flaky tests over time
2. **Automatic test promotion** - Graduate tests based on pass rate
3. **Matrix testing** - Run tests across multiple VS Code versions
4. **Performance testing** - Add `@performance` tests for benchmarks
5. **OpenShift integration** - Add `@requires-openshift` support

## References

- [Playwright Test Annotations](https://playwright.dev/docs/test-annotations)
- [Playwright Test Tags](https://blog.testable.io/playwright-test-tags/)
- [GitHub Actions Workflow Syntax](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions)
- [GitHub Reusable Workflows](https://docs.github.com/en/actions/using-workflows/reusing-workflows)
- Current workflow: [ci-repo.yml](../.github/workflows/ci-repo.yml)
- Current test config: [playwright.config.ts](../tests/playwright.config.ts)
- Test directory: [tests/e2e/tests/](../tests/e2e/tests/)

## Appendix: Example Test Migration

### Simple Test Migration

**Before:**

```typescript
test.describe(`@tier1 LLM Reversion tests | ${provider.model}`, () => {
  test("Analyze jboss-eap-quickstarts", async () => {
    // ...
  });
});
```

**After:**

```typescript
test.describe("@tier1 @release-gate LLM Reversion tests | ${provider.model}", () => {
  test("Analyze jboss-eap-quickstarts", async () => {
    // ...
  });
});
```

### Infrastructure Test Example

**New test with minikube:**

```typescript
import { test } from "../../fixtures/minikube-fixture";
import { expect } from "@playwright/test";

test.describe("@tier2 @informational @requires-minikube @slow Konveyor Hub E2E", () => {
  test("should create and analyze application in Hub", async ({ konveyorUrl, page }) => {
    // konveyorUrl is provided by fixture (either from CI env or local minikube)
    await page.goto(`${konveyorUrl}/applications`);

    // Create application
    await page.click('button:has-text("Create Application")');
    await page.fill('input[name="appName"]', "test-app");
    await page.click('button:has-text("Save")');

    // Verify creation
    await expect(page.locator("text=test-app")).toBeVisible();
  });
});
```

## Questions and Answers

**Q: What if a test needs credentials like OPENAI_API_KEY but is tagged @informational?**

A: Pass credentials to all test jobs (as shown in the workflow), but use `continue-on-error: true` for informational tests. The test will run with credentials but won't block on failure.

**Q: How do we handle tests that are flaky?**

A: Tag as `@tier3 @experimental` initially. Once stable (10+ consecutive passes), promote to `@tier2 @informational`. Use `test.retry(3)` in Playwright for known-flaky tests.

**Q: Can we run infrastructure tests on PRs?**

A: Yes, by changing the `if` condition on the `test-infrastructure` job. However, this increases CI time and may not be worth it for all PRs. Consider using PR labels to trigger infrastructure tests on-demand.

**Q: What about tests that need specific files or data?**

A: Use `@offline` tag and commit test fixtures. The existing `agent_flow_coolstore.test.ts` already does this with cached LLM responses.

**Q: How do we test the workflow changes before merging?**

A: Use a feature branch and open a draft PR. The workflow will run on the feature branch. You can also use [act](https://github.com/nektos/act) to test locally.
