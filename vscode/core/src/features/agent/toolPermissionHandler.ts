import { v4 as uuidv4 } from "uuid";
import type {
  ToolPermissionPolicy,
  ExtensionData,
  ChatMessage,
  ToolMessageValue,
} from "@editor-extensions/shared";
import { ChatMessageType } from "@editor-extensions/shared";
import type { AgentClient, PermissionRequestData } from "../../client/agentClient";
import type { AgentFileTracker } from "./fileTracker";
import { classifyTool } from "./toolClassifier";
import { executeExtensionCommand } from "../../commands";
import { routeFileChange } from "./fileChangeRouter";

// Re-export pure policy functions so existing consumers don't break
export {
  resolvePermission,
  isReadOnlyToolCall,
  shouldAutoApproveWithPolicy,
  shouldDenyWithPolicy,
  findAllowOnceOptionId,
  findRejectOnceOptionId,
  filterPermissionOptions,
  policyToGooseMode,
  policyToOpencodePermissions,
} from "./toolPermissionPolicy";

import {
  shouldAutoApproveWithPolicy,
  shouldDenyWithPolicy,
  findAllowOnceOptionId,
  findRejectOnceOptionId,
  filterPermissionOptions,
} from "./toolPermissionPolicy";

function truncateLines(text: string, maxLines: number): string {
  const lines = text.split("\n");
  const truncated = lines.slice(0, maxLines).join("\n");
  return lines.length > maxLines ? truncated + "\n..." : truncated;
}

/**
 * Extract a relative file path from rawInput for display purposes.
 */
function extractDisplayPath(
  rawInput: Record<string, unknown>,
  workspaceRoot?: string,
): string | undefined {
  const filePath = (rawInput.path ?? rawInput.file_path ?? rawInput.filename) as string | undefined;
  if (typeof filePath !== "string") {
    return undefined;
  }
  if (workspaceRoot && filePath.startsWith(workspaceRoot)) {
    return filePath.slice(workspaceRoot.length).replace(/^\//, "");
  }
  return filePath;
}

/**
 * Build a meaningful label for a permission request from its rawInput.
 *
 * Instead of showing "Developer: Text Editor" (the Goose extension + tool name),
 * this produces labels like "Edit: `ShoppingCartOrderProcessor.java`".
 */
export function buildPermissionLabel(data: PermissionRequestData, workspaceRoot?: string): string {
  if (!data.rawInput) {
    return data.toolName ?? data.title;
  }

  const displayPath = extractDisplayPath(data.rawInput, workspaceRoot);
  const command = data.rawInput.command as string | undefined;

  // Shell commands: rawInput.command IS the shell command (not a verb)
  const title = data.title ?? "";
  if (title.includes("Shell") || data.toolName === "bash" || data.toolName === "shell") {
    const shellCmd = typeof command === "string" ? command : undefined;
    if (shellCmd) {
      const truncated = shellCmd.length > 80 ? shellCmd.slice(0, 77) + "..." : shellCmd;
      return `Shell: \`${truncated}\``;
    }
    return "Shell";
  }

  // Text editor commands: command is a verb like "view", "write", "str_replace"
  const verbMap: Record<string, string> = {
    view: "Read",
    str_replace: "Edit",
    write: "Write",
    create: "Create",
    insert: "Insert",
  };

  const verb = (command && verbMap[command]) ?? "Modify";
  if (displayPath) {
    return `${verb}: \`${displayPath}\``;
  }
  return data.toolName ?? data.title;
}

/**
 * Formats a preview string from the permission request's rawInput.
 *
 * Generates ```diff code fences for file modifications:
 * - str_replace: diff from old_str → new_str
 * - write/create with originalContent: unified diff of original → new
 * - write/create without original (new file): all lines as additions
 * - view: empty (the label already says "Read")
 * - insert: shows the inserted text
 */
export function formatPermissionPreview(
  data: PermissionRequestData,
  workspaceRoot?: string,
  originalContent?: string,
): string {
  if (!data.rawInput) {
    return "";
  }

  const input = data.rawInput;
  const command = input.command as string | undefined;

  // view: no preview needed — the label says "Read: filename"
  if (command === "view") {
    return "";
  }

  // str_replace: compute real unified diff between old_str and new_str
  const oldStr = input.old_str;
  const newStr = input.new_str;
  if (typeof oldStr === "string" && typeof newStr === "string") {
    const { createPatch } = require("diff");
    const displayPath = extractDisplayPath(input, workspaceRoot) ?? "file";
    const patch = createPatch(displayPath, oldStr, newStr, "", "", { context: 3 });
    const patchLines = (patch as string).split("\n");
    const diffBody = patchLines.slice(4).join("\n");
    if (diffBody.trim()) {
      return "```diff\n" + truncateLines(diffBody, 50) + "\n```";
    }
    return "";
  }

  // write/create with file_text: generate a real diff if we have original content
  const fileText = input.file_text ?? input.content ?? input.text;
  if (typeof fileText === "string") {
    if (originalContent !== undefined) {
      // Generate unified diff
      const { createPatch } = require("diff");
      const displayPath = extractDisplayPath(input, workspaceRoot) ?? "file";
      const patch = createPatch(displayPath, originalContent, fileText, "", "", {
        context: 3,
      });
      // Strip the header lines (first 4 lines: ---, +++, etc.) and wrap in diff fence
      const patchLines = (patch as string).split("\n");
      const diffBody = patchLines.slice(4).join("\n");
      if (diffBody.trim()) {
        return "```diff\n" + truncateLines(diffBody, 50) + "\n```";
      }
      return "";
    }

    // New file (no original): show all lines as additions
    return (
      "```diff\n" +
      truncateLines(fileText, 50)
        .split("\n")
        .map((l) => "+ " + l)
        .join("\n") +
      "\n```"
    );
  }

  // insert: show the inserted text (Goose uses new_str for insert content)
  const insertText = input.insert_text ?? input.new_str;
  if (command === "insert" && typeof insertText === "string") {
    return (
      "```diff\n" +
      truncateLines(String(insertText), 30)
        .split("\n")
        .map((l) => "+ " + l)
        .join("\n") +
      "\n```"
    );
  }

  return "";
}

// ─── Shared permission request handler ──────────────────────────────

export interface PendingPermission {
  requestId: number;
  client: AgentClient;
  filePath?: string;
  fileContent?: string;
}

export interface PermissionHandlerContext {
  agentClient: AgentClient;
  data: PermissionRequestData;
  policy: ToolPermissionPolicy;
  workspaceRoot: string;
  fileTracker: AgentFileTracker | undefined;
  mutate: (recipe: (draft: ExtensionData) => void) => void;
  pendingPermissions: Map<string, PendingPermission>;
  extensionState?: import("../../extensionState").ExtensionState;
}

/**
 * Shared handler for agent permission requests.
 *
 * Applies the tool permission policy (auto-approve / auto-deny / ask user),
 * builds a label + diff preview, pushes a chat message, and notifies the
 * solution server. Used by both free-chat mode (init.ts) and the
 * getSolution orchestrator (agentOrchestrator.ts).
 */
export async function handlePermissionWithPolicy(ctx: PermissionHandlerContext): Promise<void> {
  const {
    agentClient,
    data,
    policy,
    workspaceRoot,
    fileTracker,
    mutate,
    pendingPermissions: pending,
  } = ctx;

  // Cache file before any approval decision
  if (fileTracker && data.rawInput) {
    fileTracker.cacheFileBeforeWrite(data.title, data.rawInput, workspaceRoot, data.toolCallId);
  }

  const label = buildPermissionLabel(data, workspaceRoot);

  const rawFilePath = data.rawInput
    ? ((data.rawInput.path ?? data.rawInput.file_path ?? data.rawInput.filename) as
        | string
        | undefined)
    : undefined;
  const rawFileContent = data.rawInput
    ? ((data.rawInput.new_str ?? data.rawInput.content ?? data.rawInput.file_text) as
        | string
        | undefined)
    : undefined;

  // Look up original content for real diffs
  let originalContent: string | undefined;
  if (rawFilePath && fileTracker) {
    const { join, isAbsolute } = await import("path");
    const wsRoot = workspaceRoot.startsWith("file://")
      ? new URL(workspaceRoot).pathname
      : workspaceRoot;
    const absPath = isAbsolute(rawFilePath) ? rawFilePath : join(wsRoot, rawFilePath);
    originalContent = await fileTracker.getOriginalContent(absPath, wsRoot);
  }

  const preview = formatPermissionPreview(data, workspaceRoot, originalContent);

  const isBatchReviewMode = ctx.extensionState?.data.isBatchReviewMode === true;
  const category = classifyTool(
    data.toolName ?? data.title,
    data.rawInput as Record<string, unknown> | undefined,
  );

  // --- Batch review mode: auto-approve file edits, route to review queue ---
  if (isBatchReviewMode && category === "fileEditing" && rawFilePath) {
    const optionId = findAllowOnceOptionId(data.options);
    if (optionId) {
      agentClient.respondToRequest(data.requestId, {
        outcome: { outcome: "selected", optionId },
      });

      if (ctx.extensionState) {
        routeFileChange(
          ctx.extensionState,
          rawFilePath,
          rawFileContent ?? "",
          originalContent ?? "",
        ).catch(() => {});
      }
      return;
    }
  }

  // --- Auto-approve ---
  if (shouldAutoApproveWithPolicy(policy, data)) {
    const optionId = findAllowOnceOptionId(data.options);
    if (optionId) {
      agentClient.respondToRequest(data.requestId, {
        outcome: { outcome: "selected", optionId },
      });

      if (category === "fileEditing" && rawFilePath && ctx.extensionState) {
        const isBatchReview = ctx.extensionState.data.isBatchReviewMode === true;
        if (isBatchReview) {
          routeFileChange(
            ctx.extensionState,
            rawFilePath,
            rawFileContent ?? "",
            originalContent ?? "",
          ).catch(() => {});
        } else {
          Promise.resolve(
            executeExtensionCommand("changeApplied", rawFilePath, rawFileContent ?? ""),
          ).catch(() => {});
        }
      } else if (category === "fileEditing" && rawFilePath) {
        Promise.resolve(
          executeExtensionCommand("changeApplied", rawFilePath, rawFileContent ?? ""),
        ).catch(() => {});
      }

      mutate((draft) => {
        draft.chatMessages.push({
          kind: ChatMessageType.Tool,
          messageToken: `auto-${uuidv4()}`,
          timestamp: new Date().toISOString(),
          value: {
            toolName: label,
            toolStatus: "succeeded",
          } as ToolMessageValue,
        });
      });
      return;
    }
  }

  // --- Auto-deny ---
  if (shouldDenyWithPolicy(policy, data)) {
    const rejectId = findRejectOnceOptionId(data.options);
    if (rejectId) {
      agentClient.respondToRequest(data.requestId, {
        outcome: { outcome: "selected", optionId: rejectId },
      });

      mutate((draft) => {
        draft.chatMessages.push({
          kind: ChatMessageType.String,
          messageToken: `deny-${uuidv4()}`,
          timestamp: new Date().toISOString(),
          value: { message: `**Denied:** ${label}` },
        } as ChatMessage);
      });

      if (rawFilePath) {
        Promise.resolve(executeExtensionCommand("changeDiscarded", rawFilePath)).catch(() => {});
      }
      return;
    }
  }

  // --- Ask user ---
  const messageToken = `perm-${uuidv4()}`;
  pending.set(messageToken, {
    requestId: data.requestId,
    client: agentClient,
    filePath: rawFilePath,
    fileContent: rawFileContent,
  });

  const message = preview ? `**Review:** ${label}\n\n${preview}` : `**Review:** ${label}`;

  const filteredOptions = filterPermissionOptions(data.options);

  mutate((draft) => {
    draft.chatMessages.push({
      kind: ChatMessageType.String,
      messageToken,
      timestamp: new Date().toISOString(),
      value: { message },
      quickResponses: filteredOptions.map((opt) => ({
        id: opt.optionId,
        content: opt.kind === "allow_once" ? "Accept" : "Reject",
      })),
    } as ChatMessage);
  });
}
