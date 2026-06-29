import type { PromptId } from "../src/templates.js";
import * as oracle from "./oracle.js";

export interface ParityCase {
  id: PromptId;
  name: string;
  context: Record<string, unknown>;
  expected: string;
}

const LANGS = [
  "Java",
  "kotlin",
  "Scala",
  "groovy",
  "JavaScript",
  "typescript",
  "Python",
  "go",
  "Ruby",
];

const incidents0: oracle.Incident[] = [];
const incidents1: oracle.Incident[] = [{ message: "Replace javax.* with jakarta.*" }];
const incidentsN: oracle.Incident[] = [
  { message: "Replace javax.* with jakarta.*" },
  { message: "Remove use of EJB" },
  { message: "Migrate persistence.xml" },
];
const hints0: oracle.Hint[] = [];
const hintsN: oracle.Hint[] = [{ hint: "Use CDI beans" }, { hint: "Prefer constructor injection" }];

const SUBAGENTS: Record<string, string> = {
  GeneralFix: "Handles general source code migration issues.",
  JavaDependency: "Resolves Maven pom.xml dependency problems.",
};

export const cases: ParityCase[] = [
  // --- analysis: fix-issue.system (per language) ---
  ...LANGS.map((lang) => ({
    id: "agentic.analysis.fix-issue.system" as PromptId,
    name: `fix-issue.system [${lang}]`,
    context: { programmingLanguage: lang, migrationHint: "JavaEE to Quarkus" },
    expected: oracle.fixAnalysisIssueSystem(lang, "JavaEE to Quarkus"),
  })),

  // --- analysis: fix-issue.human (lang x incidents x hints matrix) ---
  ...LANGS.flatMap((lang) =>
    [
      { incs: incidents0, hints: hints0, tag: "0inc/0hint" },
      { incs: incidents1, hints: hints0, tag: "1inc/0hint" },
      { incs: incidentsN, hints: hintsN, tag: "Ninc/Nhint" },
    ].map(({ incs, hints, tag }) => ({
      id: "agentic.analysis.fix-issue.human" as PromptId,
      name: `fix-issue.human [${lang}] ${tag}`,
      context: {
        programmingLanguage: lang,
        migrationHint: "JavaEE to Quarkus",
        fileName: "Foo.java",
        inputFileContent: "public class Foo {}\n// trailing",
        inputIncidents: incs,
        hints,
      },
      expected: oracle.fixAnalysisIssueHuman({
        programmingLanguage: lang,
        migrationHint: "JavaEE to Quarkus",
        fileName: "Foo.java",
        inputFileContent: "public class Foo {}\n// trailing",
        inputIncidents: incs,
        hints,
      }),
    })),
  ),

  // --- analysis: summarize-additional-info ---
  {
    id: "agentic.analysis.summarize-additional-info.system",
    name: "summarize-additional-info.system",
    context: { programmingLanguage: "Java", migrationHint: "JavaEE to Quarkus" },
    expected: oracle.summarizeAdditionalInfoSystem("Java", "JavaEE to Quarkus"),
  },
  ...[
    { mods: ["A.java", "B.java"], reasoning: "Changed A and B.", tag: "mods+reasoning" },
    { mods: undefined, reasoning: undefined, tag: "neither" },
    { mods: [], reasoning: "", tag: "empty-array+empty-string" },
    { mods: ["A.java"], reasoning: undefined, tag: "mods-only" },
  ].map(({ mods, reasoning, tag }) => ({
    id: "agentic.analysis.summarize-additional-info.human" as PromptId,
    name: `summarize-additional-info.human [${tag}]`,
    context: {
      migrationHint: "JavaEE to Quarkus",
      inputAllModifiedFiles: mods,
      inputAllReasoning: reasoning,
      inputAllAdditionalInfo: "Update web.xml elsewhere.",
    },
    expected: oracle.summarizeAdditionalInfoHuman({
      migrationHint: "JavaEE to Quarkus",
      inputAllModifiedFiles: mods,
      inputAllReasoning: reasoning,
      inputAllAdditionalInfo: "Update web.xml elsewhere.",
    }),
  })),

  // --- analysis: summarize-history ---
  {
    id: "agentic.analysis.summarize-history.system",
    name: "summarize-history.system",
    context: { programmingLanguage: "Java", migrationHint: "JavaEE to Quarkus" },
    expected: oracle.summarizeHistorySystem("Java", "JavaEE to Quarkus"),
  },
  {
    id: "agentic.analysis.summarize-history.human",
    name: "summarize-history.human",
    context: { migrationHint: "JavaEE to Quarkus", inputAllReasoning: "We migrated annotations." },
    expected: oracle.summarizeHistoryHuman({
      migrationHint: "JavaEE to Quarkus",
      inputAllReasoning: "We migrated annotations.",
    }),
  },

  // --- diagnostics: plan-fixes ---
  {
    id: "agentic.diagnostics.plan-fixes.system",
    name: "plan-fixes.system",
    context: { programmingLanguage: "Java", migrationHint: "JavaEE to Quarkus" },
    expected: oracle.planFixesSystem("Java", "JavaEE to Quarkus"),
  },
  ...[
    { uri: "file:///Foo.java", tasks: ["Fix import", "Add dependency"], tag: "uri+Ntasks" },
    { uri: undefined, tasks: ["Single task"], tag: "no-uri/1task" },
  ].map(({ uri, tasks, tag }) => ({
    id: "agentic.diagnostics.plan-fixes.human" as PromptId,
    name: `plan-fixes.human [${tag}]`,
    context: {
      agents: ["GeneralFix", "JavaDependency"],
      subAgents: SUBAGENTS,
      plannerInputTasksUri: uri,
      tasks,
      background: "Earlier we migrated the persistence layer.",
    },
    expected: oracle.planFixesHuman({
      agents: ["GeneralFix", "JavaDependency"],
      subAgents: SUBAGENTS,
      uri,
      tasks,
      background: "Earlier we migrated the persistence layer.",
    }),
  })),

  // --- diagnostics: fix-general ---
  {
    id: "agentic.diagnostics.fix-general.system",
    name: "fix-general.system",
    context: { programmingLanguage: "Java", migrationHint: "JavaEE to Quarkus" },
    expected: oracle.fixGeneralIssuesSystem("Java", "JavaEE to Quarkus"),
  },
  ...[
    { uris: ["file:///A.java", "file:///B.java"], tag: "Nuris" },
    { uris: undefined, tag: "no-uris" },
    { uris: [], tag: "empty-uris" },
  ].map(({ uris, tag }) => ({
    id: "agentic.diagnostics.fix-general.human" as PromptId,
    name: `fix-general.human [${tag}]`,
    context: {
      inputInstructionsForGeneralFix: "Update the imports across the module.",
      inputUrisForGeneralFix: uris,
    },
    expected: oracle.fixGeneralIssuesHuman({
      inputInstructionsForGeneralFix: "Update the imports across the module.",
      inputUrisForGeneralFix: uris,
    }),
  })),

  // --- diagnostics: fix-java-deps ---
  {
    id: "agentic.diagnostics.fix-java-deps.system",
    name: "fix-java-deps.system",
    context: { migrationHint: "JavaEE to Quarkus" },
    expected: oracle.fixJavaDependencyIssuesSystem("JavaEE to Quarkus"),
  },
  ...[
    { uris: ["file:///pom.xml"], tag: "uris" },
    { uris: undefined, tag: "no-uris" },
    { uris: [], tag: "empty-uris" },
  ].map(({ uris, tag }) => ({
    id: "agentic.diagnostics.fix-java-deps.human" as PromptId,
    name: `fix-java-deps.human [${tag}]`,
    context: {
      inputInstructionsForGeneralFix: "Add jakarta.persistence-api.",
      inputUrisForGeneralFix: uris,
    },
    expected: oracle.fixJavaDependencyIssuesHuman({
      inputInstructionsForGeneralFix: "Add jakarta.persistence-api.",
      inputUrisForGeneralFix: uris,
    }),
  })),

  // --- tools instructions (1 and N tools) ---
  ...[
    {
      tools: [{ name: "readFile", description: "Reads a file", argsJson: '{"type":"object"}' }],
      tag: "1tool",
    },
    {
      tools: [
        { name: "readFile", description: "Reads a file", argsJson: '{"type":"object"}' },
        { name: "writeFile", description: "Writes a file", argsJson: '{"type":"object","x":1}' },
      ],
      tag: "2tools",
    },
  ].map(({ tools, tag }) => ({
    id: "agentic.tools.instructions" as PromptId,
    name: `tools.instructions [${tag}]`,
    context: { tools },
    expected: oracle.getToolsAsMessage(tools),
  })),

  // --- single-shot: continue quick action ---
  {
    id: "single-shot.continue-quick-action",
    name: "continue-quick-action",
    context: {
      extensionShortName: "Konveyor",
      ruleset_name: "javax-to-jakarta",
      ruleset_description: "Migrate javax to jakarta",
      violation_name: "javax-import",
      violation_description: "javax import found",
      violation_category: "mandatory",
      message: "Replace javax with jakarta",
    },
    expected: oracle.continueQuickAction({
      extensionShortName: "Konveyor",
      ruleset_name: "javax-to-jakarta",
      ruleset_description: "Migrate javax to jakarta",
      violation_name: "javax-import",
      violation_description: "javax import found",
      violation_category: "mandatory",
      message: "Replace javax with jakarta",
    }),
  },

  // --- operational: model health check ---
  {
    id: "operational.model-health-check.system",
    name: "model-health-check.system",
    context: {},
    expected: oracle.modelHealthCheckSystem(),
  },
  {
    id: "operational.model-health-check.human",
    name: "model-health-check.human",
    context: {},
    expected: oracle.modelHealthCheckHuman(),
  },
];
