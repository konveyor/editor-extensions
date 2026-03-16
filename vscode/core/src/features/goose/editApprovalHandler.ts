import type { PermissionRequestData, PermissionOption } from "../../client/agentClient";

/**
 * Maps the extension's editApprovalMode to Goose's GOOSE_MODE env var value.
 *
 * - "ask" → "approve" (Goose asks before every tool call)
 * - "smart" → "smart_approve" (Goose asks only before write/mutating tools)
 * - "auto" → "auto" (Goose executes tools freely, no permission requests)
 */
export function editApprovalModeToGooseMode(mode: "ask" | "smart" | "auto"): string {
  switch (mode) {
    case "ask":
      return "approve";
    case "smart":
      return "smart_approve";
    case "auto":
      return "auto";
  }
}

/**
 * Determines whether a permission request should be auto-approved based on the
 * current edit approval mode.
 *
 * - "auto": Always auto-approve.
 * - "ask": Never auto-approve; always show to user.
 * - "smart": The agent decides what to ask about. If it sent a permission
 *   request, it thinks the user should see it — so we show it.
 */
export function shouldAutoApprove(
  mode: "ask" | "smart" | "auto",
  _data: PermissionRequestData,
): boolean {
  if (mode === "auto") {
    return true;
  }
  // "ask" and "smart" both show the request to the user.
  // In "smart" mode, the agent only sends requests for things it thinks
  // need approval. If it sent one, we show it.
  return false;
}

/**
 * Finds the "allow_once" option from a permission request's options list.
 * Used for auto-approval responses.
 */
export function findAllowOnceOptionId(options: PermissionOption[]): string | undefined {
  return options.find((opt) => opt.kind === "allow_once")?.optionId;
}

/**
 * Truncate a string to a maximum number of lines for preview.
 */
function truncateLines(text: string, maxLines: number): string {
  const lines = text.split("\n");
  const truncated = lines.slice(0, maxLines).join("\n");
  return lines.length > maxLines ? truncated + "\n..." : truncated;
}

/**
 * Formats a preview string from the permission request's rawInput.
 * Handles text_editor commands (str_replace, create, insert) and
 * generic write tools to show what will actually change.
 */
export function formatPermissionPreview(
  data: PermissionRequestData,
  workspaceRoot?: string,
): string {
  if (!data.rawInput) {
    return "";
  }

  const parts: string[] = [];
  const input = data.rawInput;

  const filePath = input.path ?? input.file_path ?? input.filename;
  if (typeof filePath === "string") {
    let displayPath = filePath;
    if (workspaceRoot && filePath.startsWith(workspaceRoot)) {
      displayPath = filePath.slice(workspaceRoot.length).replace(/^\//, "");
    }
    parts.push(`**File:** \`${displayPath}\``);
  }

  const command = input.command as string | undefined;

  // text_editor str_replace: show old → new
  const oldStr = input.old_str;
  const newStr = input.new_str;
  if (typeof oldStr === "string" && typeof newStr === "string") {
    parts.push(
      "```diff\n" +
        truncateLines(oldStr, 30)
          .split("\n")
          .map((l) => "- " + l)
          .join("\n") +
        "\n" +
        truncateLines(newStr, 30)
          .split("\n")
          .map((l) => "+ " + l)
          .join("\n") +
        "\n```",
    );
    return parts.join("\n");
  }

  // text_editor insert: show what's being inserted
  const insertText = input.insert_text ?? input.new_str;
  if (command === "insert" && typeof insertText === "string") {
    parts.push("**Insert:**");
    parts.push("```\n" + truncateLines(String(insertText), 30) + "\n```");
    return parts.join("\n");
  }

  // create / write: show the content being written
  const content = input.content ?? input.text ?? input.file_text;
  if (content !== null && content !== undefined) {
    parts.push("```\n" + truncateLines(String(content), 50) + "\n```");
    return parts.join("\n");
  }

  return parts.join("\n");
}

/**
 * Filters permission options to only show "Allow" and "Reject" (once).
 * "Always Allow" and "Always Reject" are confusing in the context of
 * a migration workflow — they'd silently change mode semantics.
 */
export function filterPermissionOptions(options: PermissionOption[]): PermissionOption[] {
  return options.filter((opt) => opt.kind === "allow_once" || opt.kind === "reject_once");
}
