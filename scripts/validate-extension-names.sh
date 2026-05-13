#!/usr/bin/env bash
# Validate that code doesn't hardcode "konveyor" extension names
# Instead, code should use EXTENSION_NAME and CORE_EXTENSION_ID constants

set -euo pipefail

echo "🔍 Validating extension name usage..."

VIOLATIONS=0

# Patterns to check for hardcoded konveyor strings
PATTERNS=(
  'getConfiguration\(["'\'']konveyor'
  'getExtension\(["'\'']konveyor'
  'executeCommand\(["'\'']konveyor\.'
)

# Files/directories to exclude from validation
EXCLUDE_ARGS=(
  --exclude-dir=node_modules
  --exclude-dir=dist
  --exclude-dir=downloaded_assets
  --exclude-dir=out
  --exclude-dir=.git
  --exclude='*.md'
  --exclude='*.json'
  --exclude='setup.ts'  # Test setup files legitimately set __EXTENSION_NAME__
  --exclude='data.ts'   # Test data files may contain konveyor.io labels
)

for PATTERN in "${PATTERNS[@]}"; do
  echo "Checking for pattern: $PATTERN"

  # Search for violations
  if grep -rn "${EXCLUDE_ARGS[@]}" -E "$PATTERN" vscode/ 2>/dev/null; then
    echo ""
    echo "❌ Found hardcoded 'konveyor' in configuration/extension calls!"
    echo ""
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done

if [ $VIOLATIONS -eq 0 ]; then
  echo ""
  echo "✅ No hardcoded extension names found"
  exit 0
else
  echo ""
  echo "Found $VIOLATIONS violation pattern(s)."
  echo ""
  echo "Code should use constants instead of hardcoded 'konveyor' strings:"
  echo "  - For getConfiguration(): use EXTENSION_NAME constant"
  echo "  - For getExtension(): use CORE_EXTENSION_ID constant"
  echo "  - For executeCommand(): use EXTENSION_NAME constant"
  echo ""
  echo "Example (BEFORE - wrong):"
  echo '  const config = vscode.workspace.getConfiguration("konveyor");'
  echo '  vscode.commands.executeCommand("konveyor.runAnalysis");'
  echo ""
  echo "Example (AFTER - correct):"
  echo '  import { EXTENSION_NAME } from "./utilities/constants";'
  echo '  const config = vscode.workspace.getConfiguration(EXTENSION_NAME);'
  echo '  vscode.commands.executeCommand(`${EXTENSION_NAME}.runAnalysis`);'
  echo ""
  echo "This allows downstream rebranding by changing only the package.json,"
  echo "without needing to modify source code."
  exit 1
fi
