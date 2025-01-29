import { RuleSet, Violation, EnhancedViolation } from "@editor-extensions/shared";
import { useMemo } from "react";

export function useViolations(analysisResults: RuleSet[] | undefined): EnhancedViolation[] {
  return useMemo(() => {
    if (!analysisResults?.length) {
      return [];
    }
    return analysisResults.flatMap((ruleSet) =>
      Object.entries<Violation>(ruleSet.violations || {}).map(([violationId, violation]) => ({
        id: violationId,
        ...violation,
        rulesetName: ruleSet.name,
        violationName: violationId,
      })),
    );
  }, [analysisResults]);
}
