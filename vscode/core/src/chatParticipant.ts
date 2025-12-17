import * as vscode from "vscode";
import { ExtensionState } from "./extensionState";
import { EnhancedIncident } from "@editor-extensions/shared";
import { EXTENSION_NAME, EXTENSION_SHORT_NAME } from "./utilities/constants";

/**
 * Konveyor Chat Participant for GitHub Copilot
 *
 * This module provides a @konveyor chat participant that allows users to:
 * - Query migration issues in their codebase
 * - Get explanations for specific violations
 * - Generate fixes for migration issues
 * - Run analysis on files/directories
 */

const PARTICIPANT_ID = "konveyor.chat";

interface KonveyorChatResult extends vscode.ChatResult {
  metadata: {
    command?: string;
    incidentsFound?: number;
  };
}

/**
 * Build a system prompt with migration context
 */
function buildMigrationSystemPrompt(incidents: EnhancedIncident[], activeProfile?: string): string {
  const incidentSummary =
    incidents.length > 0
      ? incidents
          .slice(0, 10) // Limit to first 10 for context window
          .map(
            (i) =>
              `- [${i.violation_category || "info"}] ${i.message} (${i.uri}:${i.lineNumber || "?"})`,
          )
          .join("\n")
      : "No migration issues detected in the current context.";

  return `You are ${EXTENSION_SHORT_NAME}, a migration and modernization assistant integrated into VS Code.
You help developers modernize their applications by:
- Explaining migration issues and their impact
- Suggesting fixes for deprecated APIs and patterns
- Guiding migration paths (e.g., Java EE to Jakarta EE, Spring Boot upgrades)

${activeProfile ? `Current migration profile: ${activeProfile}` : ""}

Current migration issues in context:
${incidentSummary}

When suggesting code changes:
1. Explain WHY the change is needed
2. Show the BEFORE and AFTER code
3. Mention any additional changes that might be needed elsewhere

Be concise but thorough. Use markdown formatting for code blocks.`;
}

/**
 * Get incidents relevant to the current context (active file or selection)
 */
function getRelevantIncidents(state: ExtensionState, currentFileUri?: string): EnhancedIncident[] {
  const allIncidents = state.data.enhancedIncidents as EnhancedIncident[];

  if (currentFileUri) {
    // Filter to current file
    return allIncidents.filter((i) => i.uri === currentFileUri);
  }

  return allIncidents;
}

/**
 * Handle the /analyze slash command
 */
async function handleAnalyzeCommand(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  state: ExtensionState,
  token: vscode.CancellationToken,
): Promise<KonveyorChatResult> {
  stream.progress("Running migration analysis...");

  // Check if analysis server is running
  if (state.data.serverState !== "running") {
    stream.markdown(
      "⚠️ The analysis server is not running. Please start the server first:\n\n" +
        "1. Open the Konveyor panel\n" +
        "2. Click 'Start Server'\n" +
        "3. Try again once the server is ready",
    );
    return { metadata: { command: "analyze" } };
  }

  // Check for active profile
  if (!state.data.activeProfileId) {
    stream.markdown(
      "⚠️ No analysis profile is selected. Please configure a migration profile first.",
    );
    return { metadata: { command: "analyze" } };
  }

  // Trigger analysis via existing command
  try {
    await vscode.commands.executeCommand(`${EXTENSION_NAME}.runAnalysis`);
    stream.markdown(
      "✅ Analysis started! You can track progress in the Konveyor panel.\n\n" +
        "Once complete, ask me about the results:\n" +
        "- *What issues were found?*\n" +
        "- *How do I fix the most critical issues?*",
    );
  } catch (error) {
    stream.markdown(`❌ Failed to start analysis: ${error}`);
  }

  return { metadata: { command: "analyze" } };
}

/**
 * Handle the /fix slash command
 */
async function handleFixCommand(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  state: ExtensionState,
  token: vscode.CancellationToken,
): Promise<KonveyorChatResult> {
  const currentFile = vscode.window.activeTextEditor?.document.uri.toString();
  const incidents = getRelevantIncidents(state, currentFile);

  if (incidents.length === 0) {
    stream.markdown(
      "No migration issues found in the current file.\n\n" +
        "Try running `/analyze` first, or open a file with migration issues.",
    );
    return { metadata: { command: "fix", incidentsFound: 0 } };
  }

  // Check if GenAI is enabled
  if (!state.modelProvider) {
    stream.markdown(
      "⚠️ GenAI is not configured. Please configure a model provider in settings to generate fixes.",
    );
    return { metadata: { command: "fix" } };
  }

  stream.progress(`Found ${incidents.length} issue(s). Generating fix...`);

  // If user specified a particular issue in their prompt, try to match it
  const targetIncident = findMatchingIncident(request.prompt, incidents);

  if (targetIncident) {
    // Fix specific incident
    stream.markdown(`### Fixing: ${targetIncident.message}\n\n`);
    stream.markdown(`**File:** \`${targetIncident.uri}\`\n`);
    stream.markdown(`**Line:** ${targetIncident.lineNumber || "N/A"}\n\n`);

    try {
      // Trigger existing fix command
      await vscode.commands.executeCommand(`${EXTENSION_NAME}.getSolution`, [targetIncident]);
      stream.markdown(
        "✅ Fix generation started! Check the Resolution panel for the proposed changes.",
      );
    } catch (error) {
      stream.markdown(`❌ Failed to generate fix: ${error}`);
    }
  } else {
    // Show list of issues and ask user to be more specific
    stream.markdown(`Found **${incidents.length}** issues in the current file:\n\n`);
    incidents.slice(0, 5).forEach((incident, idx) => {
      stream.markdown(`${idx + 1}. \`${incident.message}\` (line ${incident.lineNumber || "?"})\n`);
    });
    if (incidents.length > 5) {
      stream.markdown(`\n... and ${incidents.length - 5} more.\n`);
    }
    stream.markdown("\nTell me which issue to fix, or say **fix all** to address everything.");
  }

  return { metadata: { command: "fix", incidentsFound: incidents.length } };
}

/**
 * Handle the /explain slash command
 */
async function handleExplainCommand(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  state: ExtensionState,
  token: vscode.CancellationToken,
): Promise<KonveyorChatResult> {
  const currentFile = vscode.window.activeTextEditor?.document.uri.toString();
  const incidents = getRelevantIncidents(state, currentFile);

  if (incidents.length === 0) {
    stream.markdown(
      "No migration issues found to explain.\n\n" + "Run `/analyze` first to detect issues.",
    );
    return { metadata: { command: "explain" } };
  }

  const targetIncident = findMatchingIncident(request.prompt, incidents);

  if (targetIncident) {
    stream.markdown(`## ${targetIncident.violation_name || "Migration Issue"}\n\n`);
    stream.markdown(`**Category:** ${targetIncident.violation_category || "N/A"}\n`);
    stream.markdown(`**Ruleset:** ${targetIncident.ruleset_name || "N/A"}\n\n`);
    stream.markdown(
      `### Description\n${targetIncident.violation_description || targetIncident.message}\n\n`,
    );

    if (targetIncident.codeSnip) {
      stream.markdown(`### Affected Code\n\`\`\`\n${targetIncident.codeSnip}\n\`\`\`\n\n`);
    }

    stream.markdown(
      `### Next Steps\n` +
        `Use \`/fix ${targetIncident.message.slice(0, 30)}...\` to generate a fix for this issue.`,
    );
  } else {
    // Provide overview of all issues
    stream.markdown(`## Migration Issues Overview\n\n`);

    const byCategory = groupByCategory(incidents);
    for (const [category, categoryIncidents] of Object.entries(byCategory)) {
      stream.markdown(`### ${category} (${categoryIncidents.length})\n`);
      categoryIncidents.slice(0, 3).forEach((i) => {
        stream.markdown(`- ${i.message}\n`);
      });
      if (categoryIncidents.length > 3) {
        stream.markdown(`- ... and ${categoryIncidents.length - 3} more\n`);
      }
      stream.markdown("\n");
    }
  }

  return { metadata: { command: "explain" } };
}

/**
 * Handle the /issues slash command - list current issues
 */
async function handleIssuesCommand(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  state: ExtensionState,
  token: vscode.CancellationToken,
): Promise<KonveyorChatResult> {
  const currentFile = vscode.window.activeTextEditor?.document.uri.toString();
  const fileOnly = request.prompt.toLowerCase().includes("file");

  const incidents = fileOnly
    ? getRelevantIncidents(state, currentFile)
    : (state.data.enhancedIncidents as EnhancedIncident[]);

  if (incidents.length === 0) {
    stream.markdown(
      fileOnly
        ? "No migration issues in the current file."
        : "No migration issues found. Run `/analyze` to scan your codebase.",
    );
    return { metadata: { command: "issues", incidentsFound: 0 } };
  }

  stream.markdown(`## Migration Issues ${fileOnly ? "(Current File)" : "(All)"}\n\n`);
  stream.markdown(`Found **${incidents.length}** issue(s):\n\n`);

  const byFile = groupByFile(incidents);
  let count = 0;
  const MAX_DISPLAY = 20;

  for (const [file, fileIncidents] of Object.entries(byFile)) {
    if (count >= MAX_DISPLAY) {
      stream.markdown(`\n*... and more. Open the Konveyor panel to see all issues.*`);
      break;
    }

    const shortPath = file.split("/").slice(-2).join("/");
    stream.markdown(`### ${shortPath}\n`);

    for (const incident of fileIncidents) {
      if (count >= MAX_DISPLAY) {
        break;
      }
      const severity = incident.violation_category === "mandatory" ? "🔴" : "🟡";
      stream.markdown(`${severity} Line ${incident.lineNumber || "?"}: ${incident.message}\n`);
      count++;
    }
    stream.markdown("\n");
  }

  return { metadata: { command: "issues", incidentsFound: incidents.length } };
}

/**
 * Default handler for general questions
 */
async function handleGeneralQuestion(
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  state: ExtensionState,
  token: vscode.CancellationToken,
): Promise<KonveyorChatResult> {
  const currentFile = vscode.window.activeTextEditor?.document.uri.toString();
  const incidents = getRelevantIncidents(state, currentFile);
  const activeProfile = state.data.profiles.find((p) => p.id === state.data.activeProfileId);

  // Try to use VS Code's Language Model API (Copilot)
  const models = await vscode.lm.selectChatModels({
    vendor: "copilot",
    family: "gpt-4o",
  });

  if (models.length === 0) {
    // Fallback: provide helpful response without LLM
    stream.markdown(
      `I can help you with migration and modernization tasks. Here are some things you can ask:\n\n` +
        `- \`/issues\` - List all migration issues\n` +
        `- \`/analyze\` - Run migration analysis\n` +
        `- \`/fix\` - Generate a fix for an issue\n` +
        `- \`/explain\` - Explain a migration issue\n\n` +
        `You currently have **${incidents.length}** issues detected.`,
    );
    return { metadata: {} };
  }

  // Build context-aware prompt
  const systemPrompt = buildMigrationSystemPrompt(incidents, activeProfile?.name);

  const messages = [
    vscode.LanguageModelChatMessage.Assistant(systemPrompt),
    ...context.history
      .filter((h): h is vscode.ChatRequestTurn => h instanceof vscode.ChatRequestTurn)
      .slice(-3) // Include last 3 turns for context
      .map((h) => vscode.LanguageModelChatMessage.User(h.prompt)),
    vscode.LanguageModelChatMessage.User(request.prompt),
  ];

  stream.progress("Thinking...");

  try {
    const response = await models[0].sendRequest(messages, {}, token);

    for await (const chunk of response.text) {
      if (token.isCancellationRequested) {
        break;
      }
      stream.markdown(chunk);
    }
  } catch (error) {
    if (error instanceof vscode.LanguageModelError) {
      stream.markdown(`⚠️ ${error.message}`);
    } else {
      throw error;
    }
  }

  return { metadata: { incidentsFound: incidents.length } };
}

/**
 * Find an incident that matches the user's description
 */
function findMatchingIncident(
  query: string,
  incidents: EnhancedIncident[],
): EnhancedIncident | undefined {
  if (!query || query.trim().length === 0) {
    return undefined;
  }

  const lowerQuery = query.toLowerCase();

  // Try exact message match first
  const exactMatch = incidents.find((i) => i.message.toLowerCase().includes(lowerQuery));
  if (exactMatch) {
    return exactMatch;
  }

  // Try violation name match
  const nameMatch = incidents.find((i) => i.violation_name?.toLowerCase().includes(lowerQuery));
  if (nameMatch) {
    return nameMatch;
  }

  // Try line number match
  const lineMatch = lowerQuery.match(/line\s*(\d+)/);
  if (lineMatch) {
    const lineNum = parseInt(lineMatch[1], 10);
    const lineIncident = incidents.find((i) => i.lineNumber === lineNum);
    if (lineIncident) {
      return lineIncident;
    }
  }

  return undefined;
}

/**
 * Group incidents by category
 */
function groupByCategory(incidents: EnhancedIncident[]): Record<string, EnhancedIncident[]> {
  const groups: Record<string, EnhancedIncident[]> = {};
  for (const incident of incidents) {
    const category = incident.violation_category || "uncategorized";
    if (!groups[category]) {
      groups[category] = [];
    }
    groups[category].push(incident);
  }
  return groups;
}

/**
 * Group incidents by file
 */
function groupByFile(incidents: EnhancedIncident[]): Record<string, EnhancedIncident[]> {
  const groups: Record<string, EnhancedIncident[]> = {};
  for (const incident of incidents) {
    const file = incident.uri;
    if (!groups[file]) {
      groups[file] = [];
    }
    groups[file].push(incident);
  }
  return groups;
}

/**
 * Register the Konveyor Chat Participant
 */
export function registerChatParticipant(
  context: vscode.ExtensionContext,
  state: ExtensionState,
): vscode.Disposable {
  const handler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    chatContext: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<KonveyorChatResult> => {
    state.logger.info(
      `Chat request received: command=${request.command}, prompt="${request.prompt}"`,
    );

    try {
      // Handle slash commands
      switch (request.command) {
        case "analyze":
          return handleAnalyzeCommand(request, stream, state, token);
        case "fix":
          return handleFixCommand(request, stream, state, token);
        case "explain":
          return handleExplainCommand(request, stream, state, token);
        case "issues":
          return handleIssuesCommand(request, stream, state, token);
        default:
          return handleGeneralQuestion(request, chatContext, stream, state, token);
      }
    } catch (error) {
      state.logger.error("Chat participant error:", error);
      stream.markdown(`❌ An error occurred: ${error instanceof Error ? error.message : error}`);
      return { metadata: {} };
    }
  };

  // Create the chat participant
  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);

  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "resources", "icon.png");

  // Provide follow-up suggestions based on context
  participant.followupProvider = {
    provideFollowups(
      result: KonveyorChatResult,
      context: vscode.ChatContext,
      token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.ChatFollowup[]> {
      const followups: vscode.ChatFollowup[] = [];

      if (result.metadata.command === "analyze") {
        followups.push({
          prompt: "What issues were found?",
          label: "View Issues",
          command: "issues",
        });
      }

      if (result.metadata.incidentsFound && result.metadata.incidentsFound > 0) {
        followups.push({
          prompt: "Fix the most critical issue",
          label: "Fix Issue",
          command: "fix",
        });
        followups.push({
          prompt: "Explain the issues in detail",
          label: "Explain",
          command: "explain",
        });
      }

      if (!result.metadata.command) {
        followups.push({
          prompt: "Run analysis",
          label: "Analyze",
          command: "analyze",
        });
      }

      return followups;
    },
  };

  state.logger.info("Konveyor Chat Participant registered");

  return participant;
}
