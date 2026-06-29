export function buildRulesetsList(
  profile: { useDefaultRules: boolean; customRules: readonly string[] },
  coreRulesetsPath: string,
  providerRulesets: string[],
): string[] {
  return [
    profile.useDefaultRules ? coreRulesetsPath : null,
    ...(profile.useDefaultRules ? providerRulesets : []),
    ...(profile.customRules || []),
  ].filter(Boolean) as string[];
}
