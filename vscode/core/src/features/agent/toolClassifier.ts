import type { ToolCategory } from "@editor-extensions/shared";

/** Known tool names per category, normalized to lowercase */
const FILE_EDITING_TOOLS = new Set([
  "edit",
  "write",
  "multiedit",
  "multi_edit",
  "text_editor",
  "text editor",
  "apply_patch",
  "patch",
  "create",
  "str_replace_editor",
  "notebookedit",
]);

const COMMAND_EXECUTION_TOOLS = new Set(["bash", "shell", "execute", "run_command", "terminal"]);

const WEB_ACCESS_TOOLS = new Set([
  "webfetch",
  "web_fetch",
  "websearch",
  "web_search",
  "curl",
  "fetch",
  "http",
]);

/**
 * Read-only Text Editor commands that should NOT be classified as file editing.
 * When rawInput.command is one of these, the tool is informational.
 */
const TEXT_EDITOR_READ_COMMANDS = new Set(["view", "undo_edit"]);

/**
 * Normalize a Goose-style tool title like "Developer: Text Editor"
 * into the tool part ("text editor"). Returns the original string
 * if no colon-prefix is present.
 */
function extractToolName(title: string): string {
  const colonIdx = title.indexOf(":");
  if (colonIdx >= 0) {
    return title.slice(colonIdx + 1).trim();
  }
  return title;
}

/**
 * Classify a tool call into one of the generic ToolCategory values.
 *
 * Handles multiple naming conventions:
 *  - Simple names: "bash", "text_editor"
 *  - Goose-style: "Developer: Text Editor", "Developer: Shell"
 *
 * For Text Editor calls, rawInput.command distinguishes reads ("view")
 * from writes ("str_replace", "write", "create") so reads aren't
 * classified as file editing.
 */
export function classifyTool(toolName: string, rawInput?: Record<string, unknown>): ToolCategory {
  const raw = toolName.toLowerCase();
  const extracted = extractToolName(raw);

  // Check both the raw name and the extracted (post-colon) name
  const candidates = raw === extracted ? [raw] : [raw, extracted];

  for (const name of candidates) {
    if (FILE_EDITING_TOOLS.has(name)) {
      // Text Editor with a read-only command (e.g., "view") is not a file edit
      const command = rawInput?.command;
      if (typeof command === "string" && TEXT_EDITOR_READ_COMMANDS.has(command.toLowerCase())) {
        return "other";
      }
      return "fileEditing";
    }
    if (COMMAND_EXECUTION_TOOLS.has(name)) {
      return "commandExecution";
    }
    if (WEB_ACCESS_TOOLS.has(name)) {
      return "webAccess";
    }
    if (name.startsWith("mcp__") || name.startsWith("mcp_")) {
      return "mcpTools";
    }
  }

  return "other";
}
