/**
 * Extract the rulesets path from a language extension's package.json.
 * Throws immediately when the field is missing so packaging bugs are caught early.
 */
export function getIncludedRulesetsPath(packageJSON: Record<string, unknown>): string {
  const paths = packageJSON.includedAssetPaths as Record<string, string> | undefined;
  const rulesetsPath = paths?.rulesets;
  if (!rulesetsPath) {
    throw new Error(
      "includedAssetPaths.rulesets is missing from package.json — this indicates a packaging bug",
    );
  }
  return rulesetsPath;
}
