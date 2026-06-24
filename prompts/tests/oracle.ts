/**
 * PARITY ORACLE — the source of truth for byte-exact migration.
 *
 * Every function here is a VERBATIM copy of the prompt string-building logic as
 * it exists in compiled application code, immediately before extraction. The
 * parity suite asserts that `renderPrompt(id, ctx)` reproduces these strings
 * byte-for-byte. Do NOT "clean up" or reflow anything in this file — quirks
 * (missing spaces from `\` line-continuations, curly quotes, trailing newlines)
 * are intentional and are exactly what the templates must reproduce.
 *
 * Sources (pre-refactor):
 *   - agentic/src/nodes/analysisIssueFix.ts
 *   - agentic/src/nodes/diagnosticsIssueFix.ts
 *   - agentic/src/nodes/base.ts
 *   - vscode/core/src/commands.ts
 *   - vscode/core/src/modelProvider/modelProvider.ts
 */

export interface Incident {
  message: string;
}
export interface Hint {
  hint: string;
}
export interface ToolDescriptor {
  name: string;
  description: string;
  argsJson: string;
}

// ---------------------------------------------------------------------------
// analysisIssueFix.ts — getDependencyGuidance (lines 46-77)
// ---------------------------------------------------------------------------
export function getDependencyGuidance(programmingLanguage: string): string {
  const language = programmingLanguage.toLowerCase();

  if (
    language === "java" ||
    language === "kotlin" ||
    language === "scala" ||
    language === "groovy"
  ) {
    return `Pay attention to changes you make and impacts to external dependencies in the pom.xml as well as changes to imports we need to consider.
Remember when updating or adding annotations that the class must be imported.
As you make changes that impact the pom.xml or imports, be sure you explain what needs to be updated.`;
  }

  if (language === "javascript" || language === "typescript") {
    return `Pay attention to changes you make and impacts to external dependencies in package.json as well as changes to imports we need to consider.
As you make changes that impact package.json or imports, be sure you explain what needs to be updated.`;
  }

  if (language === "python") {
    return `Pay attention to changes you make and impacts to external dependencies in requirements.txt or pyproject.toml as well as changes to imports we need to consider.
As you make changes that impact dependencies or imports, be sure you explain what needs to be updated.`;
  }

  if (language === "go") {
    return `Pay attention to changes you make and impacts to external dependencies in go.mod as well as changes to imports we need to consider.
As you make changes that impact go.mod or imports, be sure you explain what needs to be updated.`;
  }
  // Generic fallback for other languages
  return `Pay attention to changes you make and impacts to external dependencies as well as changes to imports we need to consider.
As you make changes that impact dependencies or imports, be sure you explain what needs to be updated.`;
}

// ---------------------------------------------------------------------------
// analysisIssueFix.ts — fixAnalysisIssue (lines 266-313)
// ---------------------------------------------------------------------------
export function fixAnalysisIssueSystem(programmingLanguage: string, migrationHint: string): string {
  return `You are an experienced ${programmingLanguage.toLowerCase()} developer, who specializes in migrating code from ${migrationHint}`;
}

export function fixAnalysisIssueHuman(args: {
  programmingLanguage: string;
  migrationHint: string;
  fileName: string;
  inputFileContent: string;
  inputIncidents: Incident[];
  hints: Hint[];
}): string {
  const { programmingLanguage, migrationHint, fileName, inputFileContent, inputIncidents, hints } =
    args;
  const dependencyGuidance = getDependencyGuidance(programmingLanguage);
  return `I will give you a file for which I want to take one step towards migrating ${migrationHint}.
I will provide you with static source code analysis information highlighting an issue which needs to be addressed.
Fix all the issues described. Other problems will be solved in subsequent steps so it is unnecessary to handle them now.
Before attempting to migrate the code from ${migrationHint}, reason through what changes are required and why.

${dependencyGuidance}
After you have shared your step by step thinking, provide a full output of the updated file.

**It is essential that you always output the entire updated file without omitting any unchanged code.**

# Input information

## Input File

File name: "${fileName}"
Source file contents:
\`\`\`
${inputFileContent}
\`\`\`

## Issues
${inputIncidents
  .map((incident) => {
    return `* ${incident.message}`;
  })
  .join("\n")}
${hints.length > 0 ? `\n## Hints\n${hints.map((hint) => `* ${hint.hint}`).join("\n")}` : ""}

# Output Instructions
Structure your output in Markdown format such as:

## Reasoning
Write the step by step reasoning in this markdown section. If you are unsure of a step or reasoning, clearly state you are unsure and why.

## Updated File
// Write the updated file in this section. If the file should be removed, make the content of the updated file a comment explaining it should be removed.

## Additional Information (optional)

If you have any additional details or steps that need to be performed, put it here. Do not summarize any of the changes you already made in this section. Only mention any additional changes needed.`;
}

// ---------------------------------------------------------------------------
// analysisIssueFix.ts — summarizeAdditionalInformation (lines 366-407)
// ---------------------------------------------------------------------------
export function summarizeAdditionalInfoSystem(
  programmingLanguage: string,
  migrationHint: string,
): string {
  return `You are an experienced ${programmingLanguage} programmer, specializing in migrating source code to ${migrationHint}. Your job is to read migration notes and output only the additional changes that are still needed elsewhere in the project.`;
}

export function summarizeAdditionalInfoHuman(args: {
  migrationHint: string;
  inputAllModifiedFiles?: string[];
  inputAllReasoning?: string;
  inputAllAdditionalInfo: string;
}): string {
  const { migrationHint, inputAllModifiedFiles, inputAllReasoning, inputAllAdditionalInfo } = args;
  return `During the migration to ${migrationHint}, we captured notes that include:
- A list of files we modified
- Reasoning behind changes made to existing files
- Additional information that may contain even more changes needed

* Your task:
Carefully analyze the reasoning and additional information for each file, and determine if there are any additional changes needed to complete the migration. \
Provide a concise summary *solely* of the additional changes required elsewhere in the project. \
**It is essential that your summary includes only the additional changes needed. Do not include changes already made.** \
Make sure you output all the details about the changes including any relevant code snippets and instructions.
**Do not omit any additional changes needed. Be exhaustive and specific.**

* Rules:
- Only the files listed under MODIFIED_FILES are already changed. Any file **not** in MODIFIED_FILES is unmodified.
- Treat sections named “Summary of changes made” as implemented changes only for the files listed in MODIFIED_FILES.
- Treat “Additional information / notes / rationale” as proposed work, not-yet-applied.
- If there are no additional changes needed, respond with exactly:
NO-CHANGE: <one-sentence reason>

Here is your input:

${inputAllModifiedFiles ? `### MODIFIED_FILES\n\n${inputAllModifiedFiles?.join("\n")}` : ""}

${
  inputAllReasoning && inputAllReasoning.length > 0
    ? `### Summary of changes made\n\n${inputAllReasoning}`
    : ""
}

### Additional information about changes

${inputAllAdditionalInfo}
`;
}

// ---------------------------------------------------------------------------
// analysisIssueFix.ts — summarizeHistory (lines 439-451)
// ---------------------------------------------------------------------------
export function summarizeHistorySystem(programmingLanguage: string, migrationHint: string): string {
  return `You are an experienced ${programmingLanguage} programmer, specializing in migrating source code to ${migrationHint}.`;
}

export function summarizeHistoryHuman(args: {
  migrationHint: string;
  inputAllReasoning: string;
}): string {
  const { migrationHint, inputAllReasoning } = args;
  return `During the migration to ${migrationHint}, we captured the following notes detailing changes we made to the source code.\
These notes may also mention potential future changes.\
Your task is to carefully analyze these notes and provide a concise summary *solely* of the changes that have already been implemented.\
**It is essential that your summary includes only the modifications explicitly described as completed and accurately reflects the list of files already changed.\
Do not include any information about potential future changes.**\
This summary will serve as a record of completed modifications for other team members.\
Here are the notes:
### Reasoning for fixes made
${inputAllReasoning}`;
}

// ---------------------------------------------------------------------------
// diagnosticsIssueFix.ts — planFixes (lines 277-332)
// ---------------------------------------------------------------------------
export function planFixesSystem(programmingLanguage: string, migrationHint: string): string {
  return `You are an experienced architect overlooking migration of a ${programmingLanguage} application from ${migrationHint}. Your expertise lies in efficiently delegating tasks to the most appropriate specialist to ensure optimal problem resolution.`;
}

export function planFixesHuman(args: {
  agents: string[];
  subAgents: Record<string, string>;
  uri?: string;
  tasks: string[];
  background: string;
}): string {
  const { agents, subAgents, uri, tasks, background } = args;
  let agentDescriptions = "";
  agents.forEach((a) => {
    agentDescriptions += `\n-\tName: ${a}\tDescription: ${subAgents[a]}`;
  });

  return `You have a roster of specialized agents at your disposal, each with unique capabilities and areas of focus.\
For context, you are also given background information on changes we made so far to migrate the application.\

**Here is the list of available agents, along with their descriptions:**
${agentDescriptions}

${
  uri
    ? `** File in which issues were found: ${uri}.
Make sure your instructions are specific to fixing issues in this file.`
    : ""
}

**Here is the list of issues that need to be solved:**
- ${tasks.join("\n - ")}

**Previous context about migration**
${background}

Your primary task is to carefully analyze **each individual issue** in the list.\
For each issue, you must determine the most suitable specialized agent to address it.\
You should group related issues that can be efficiently solved by the same agent, ensuring the **most specific agent** is chosen for the grouped issues.
If an an issue, or a group of issues, requires a different specialist, you **must** create a new delegation block for that specialist.
Your instructions to each agent must be specific, clear, and tailored to their expertise, detailing how they should approach and solve the assigned problems.\
**Make sure** your instructions take into account previous changes we made for migrating the project and align with the overall migration effort.\
Consider the nuances of each issue and match it precisely with the described capabilities of the agents.\
If no specialized agent is a perfect fit for an issue or a group of issues, direct it to the generalist agent with comprehensive instructions.
**Make sure all issues from the list are addressed.** You will likely need to delegate to more than one agent to address all issues effectively.

Your response **must** consist of one or more distinct blocks, each delegating tasks to a specific agent. Each block **must** follow this exact format:
* Name
<agent_name_here_on_newline>
* Instructions
<detailed_instructions_here_on_newline>

**Example of expected output structure (if multiple agents are chosen to address different issues):**
* Name
<Agent_A_Name>
* Instructions
Instructions for Agent A to solve Issue 1, Issue 2, etc. (mention specific issues)

* Name
<Agent_B_Name>
* Instructions
Instructions for Agent B to solve Issue 3, Issue 4, etc. (mention specific issues)
`;
}

// ---------------------------------------------------------------------------
// diagnosticsIssueFix.ts — fixGeneralIssues (lines 365-391)
// ---------------------------------------------------------------------------
export function fixGeneralIssuesSystem(programmingLanguage: string, migrationHint: string): string {
  return `You are an experienced ${programmingLanguage} programmer, specializing in migrating source code from ${migrationHint}.\
We updated a source code file to migrate the source code. There may be more changes needed elsewhere in the project.\
You are given notes detailing additional changes that need to happen.\
Carefully analyze the changes and understand what files in the project need to be changed.\
The notes may contain details about changes already made. Please do not act on any of the changes already made. Assume they are correct and only focus on any additional changes needed.\
You have access to a set of tools to search for files, read a file and write to a file.\
Work on one file at a time. **Completely address changes in one file before moving onto to next file.**\
Explain you rationale while you make changes to files.\
When you're done addressing all the changes or there are no additional changes, briefly summarize changes you made.\
**User may or may not accept the changes you make. If rejected, do not take any action.**\
`;
}

export function fixGeneralIssuesHuman(args: {
  inputInstructionsForGeneralFix: string;
  inputUrisForGeneralFix?: string[];
}): string {
  const { inputInstructionsForGeneralFix, inputUrisForGeneralFix } = args;
  return `
Here are the notes:\
${inputInstructionsForGeneralFix}
${
  inputUrisForGeneralFix && inputUrisForGeneralFix.length > 0
    ? `The above issues were found in following files:\n${inputUrisForGeneralFix.join("\n")}`
    : ``
}`;
}

// ---------------------------------------------------------------------------
// diagnosticsIssueFix.ts — fixJavaDependencyIssues (lines 429-460)
// ---------------------------------------------------------------------------
export function fixJavaDependencyIssuesSystem(migrationHint: string): string {
  return `You are an expert Java developer specializing in dependency management and migrating source code from / to ${migrationHint}.`;
}

export function fixJavaDependencyIssuesHuman(args: {
  inputInstructionsForGeneralFix: string;
  inputUrisForGeneralFix?: string[];
}): string {
  const { inputInstructionsForGeneralFix, inputUrisForGeneralFix } = args;
  return `
Your task is to resolve compilation or runtime errors in a Java project by identifying and adding missing dependencies to the project's pom.xml file.

**Your Goal:**
Successfully add necessary dependencies or modify existing dependencies to resolve identified issues, ensuring the project compiles and runs correctly.
If you cannot find a dependency to add after a few attempts, do not take any action.

**Information Provided:**
You will be given detailed information about the issues found, which may include compilation errors, stack traces from runtime errors, or descriptions of missing classes/methods.\
You will also be given detailed instructions on how to fix the issues.\

**Guidelines:**
- Determine whether the given issue can be fixed by adding, modifying, updating or deleting one or more dependency.\
- You have access to a set of tools to search for files, read a file and write to a file.\
- You also have access to specific tools that will help you determine which dependency to add.\
- If the given issue cannot be solved by adding, modifying, updating or deleting dependencies, do not take any action.\
- Explain your rationale as you make changes.
- User may or may not accept the changes you make. If rejected, do not take any action.\

${
  inputUrisForGeneralFix && inputUrisForGeneralFix.length > 0
    ? `* Files in which these issues were found:\n${inputUrisForGeneralFix.join("\n")}`
    : ``
}

Here are the issues:\
${inputInstructionsForGeneralFix}
`;
}

// ---------------------------------------------------------------------------
// base.ts — renderTextDescriptionAndArgs (370-376) + getToolsAsMessage (353-367)
// ---------------------------------------------------------------------------
export function renderTextDescriptionAndArgs(tools: ToolDescriptor[]): string {
  let description = "";
  tools.forEach((tool) => {
    description += `${tool.name}: ${tool.description}, Args: ${tool.argsJson}\n`;
  });
  return description;
}

export function getToolsAsMessage(tools: ToolDescriptor[]): string {
  if (!tools || tools.length < 1) {
    return "";
  }
  return `You are an intelligent developer. You are designed to use tools to answer user questions.\
You may not know all of the information to address user's needs. You will use relevant tools to get that information.\
Here is the schema of tools you are given:

${renderTextDescriptionAndArgs(tools)}

If you do need to call a tool, respond with text 'TOOL_CALL' on a new line followed by a JSON object on the next line containing only two keys - tool_name and args.\
'tool_name' should be the name of the tool to call. 'args' should be nested JSON containing the arguments to pass to the function in key value format.
Make sure you always use \`\`\` at the start and end of the JSON block to clearly separate it from text.\
*Crucially* you must only output one tool call at a time. After the tool call, wait for the results before considering another tool call if necessary.
`;
}

// ---------------------------------------------------------------------------
// vscode/core/src/commands.ts (line 432) — Continue.dev single-shot quick action
// ---------------------------------------------------------------------------
export function continueQuickAction(args: {
  extensionShortName: string;
  ruleset_name: string;
  ruleset_description: string;
  violation_name: string;
  violation_description: string;
  violation_category: string;
  message: string;
}): string {
  const {
    extensionShortName,
    ruleset_name,
    ruleset_description,
    violation_name,
    violation_description,
    violation_category,
    message,
  } = args;
  return `Help me address this ${extensionShortName} migration issue:\nRule: ${ruleset_name} - ${ruleset_description}\nViolation: ${violation_name} - ${violation_description}\nCategory: ${violation_category}\nMessage: ${message}`;
}

// ---------------------------------------------------------------------------
// vscode/core/src/modelProvider/modelProvider.ts (lines 256-259) — health check
// ---------------------------------------------------------------------------
export function modelHealthCheckSystem(): string {
  return `Use the tool you are given to get the answer for custom math operation.`;
}
export function modelHealthCheckHuman(): string {
  return `What is 2 gamma 2?`;
}
