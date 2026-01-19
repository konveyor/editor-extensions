#!/usr/bin/env bash
# Validate that all E2E tests have proper tier tags

set -euo pipefail

cd tests

echo "🔍 Validating E2E test tags using Playwright..."

# Find tests without tier tags
# Note: Playwright returns non-zero when no tests found, so we need to handle that
OUTPUT=$(npx playwright test --list --grep-invert "@tier0|@tier1|@tier2|@tier3" 2>&1 || true)

# Check if all tests have tags (should find 0 tests)
# Note: Playwright outputs "Error: No tests found" when grep-invert matches nothing, which is success for us
if echo "$OUTPUT" | grep -q "Total: 0 tests in 0 files"; then
  echo "✅ All tests have tier tags"
  exit 0
else
  echo ""
  echo "❌ Found tests without tier tags!"
  echo ""
  echo "$OUTPUT"
  echo ""
  echo "All test.describe() blocks must include a tier tag:"
  echo "  - @tier0 = Critical (blocks PRs and releases)"
  echo "  - @tier1 = Important (blocks releases only)"
  echo "  - @tier2 = Nice-to-have (never blocks)"
  echo "  - @tier3 = Experimental (never blocks)"
  echo ""
  echo "Example:"
  echo "  test.describe('My test', { tag: ['@tier0'] }, () => {"
  echo "    // tests..."
  echo "  });"
  echo ""
  echo "See docs/test-categorization.md for guidelines."
  exit 1
fi
