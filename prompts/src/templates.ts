// Static, explicit imports of every governed template asset. These are inlined
// as text at build time (esbuild `.hbs` text loader) and under test (jest
// hbs transform), so the bundle is fully self-contained with no runtime fs.

import fixIssueSystem from "../templates/agentic/analysis/fix-issue.system.hbs";
import fixIssueHuman from "../templates/agentic/analysis/fix-issue.human.hbs";
import summarizeAdditionalInfoSystem from "../templates/agentic/analysis/summarize-additional-info.system.hbs";
import summarizeAdditionalInfoHuman from "../templates/agentic/analysis/summarize-additional-info.human.hbs";
import summarizeHistorySystem from "../templates/agentic/analysis/summarize-history.system.hbs";
import summarizeHistoryHuman from "../templates/agentic/analysis/summarize-history.human.hbs";
import planFixesSystem from "../templates/agentic/diagnostics/plan-fixes.system.hbs";
import planFixesHuman from "../templates/agentic/diagnostics/plan-fixes.human.hbs";
import fixGeneralSystem from "../templates/agentic/diagnostics/fix-general.system.hbs";
import fixGeneralHuman from "../templates/agentic/diagnostics/fix-general.human.hbs";
import fixJavaDepsSystem from "../templates/agentic/diagnostics/fix-java-deps.system.hbs";
import fixJavaDepsHuman from "../templates/agentic/diagnostics/fix-java-deps.human.hbs";
import toolsInstructions from "../templates/agentic/tools/instructions.hbs";
import continueQuickAction from "../templates/single-shot/continue-quick-action.hbs";
import modelHealthCheckSystem from "../templates/operational/model-health-check.system.hbs";
import modelHealthCheckHuman from "../templates/operational/model-health-check.human.hbs";

import depGuidanceJvm from "../templates/agentic/partials/dependency-guidance-jvm.hbs";
import depGuidanceJavascript from "../templates/agentic/partials/dependency-guidance-javascript.hbs";
import depGuidancePython from "../templates/agentic/partials/dependency-guidance-python.hbs";
import depGuidanceGo from "../templates/agentic/partials/dependency-guidance-go.hbs";
import depGuidanceDefault from "../templates/agentic/partials/dependency-guidance-default.hbs";

export const templateSources = {
  "agentic.analysis.fix-issue.system": fixIssueSystem,
  "agentic.analysis.fix-issue.human": fixIssueHuman,
  "agentic.analysis.summarize-additional-info.system": summarizeAdditionalInfoSystem,
  "agentic.analysis.summarize-additional-info.human": summarizeAdditionalInfoHuman,
  "agentic.analysis.summarize-history.system": summarizeHistorySystem,
  "agentic.analysis.summarize-history.human": summarizeHistoryHuman,
  "agentic.diagnostics.plan-fixes.system": planFixesSystem,
  "agentic.diagnostics.plan-fixes.human": planFixesHuman,
  "agentic.diagnostics.fix-general.system": fixGeneralSystem,
  "agentic.diagnostics.fix-general.human": fixGeneralHuman,
  "agentic.diagnostics.fix-java-deps.system": fixJavaDepsSystem,
  "agentic.diagnostics.fix-java-deps.human": fixJavaDepsHuman,
  "agentic.tools.instructions": toolsInstructions,
  "single-shot.continue-quick-action": continueQuickAction,
  "operational.model-health-check.system": modelHealthCheckSystem,
  "operational.model-health-check.human": modelHealthCheckHuman,
} as const;

export type PromptId = keyof typeof templateSources;

export const partialSources: Record<string, string> = {
  "dependency-guidance-jvm": depGuidanceJvm,
  "dependency-guidance-javascript": depGuidanceJavascript,
  "dependency-guidance-python": depGuidancePython,
  "dependency-guidance-go": depGuidanceGo,
  "dependency-guidance-default": depGuidanceDefault,
};
