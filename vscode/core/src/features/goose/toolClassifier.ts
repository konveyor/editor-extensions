import type { ToolCategory } from "@editor-extensions/shared";

/** Known tool names per category, normalized to lowercase */
const FILE_EDITING_TOOLS = new Set([
  "edit",
  "write",
  "multiedit",
  "multi_edit",
  "text_editor",
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
 * Classify a tool call into one of the generic ToolCategory values.
 *
 * Works across all agent backends — tool names are normalized to lowercase
 * and matched against known sets. MCP tools are detected by prefix.
 */
export function classifyTool(toolName: string, _rawInput?: Record<string, unknown>): ToolCategory {
  const name = toolName.toLowerCase();
  if (FILE_EDITING_TOOLS.has(name)) {
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
  return "other";
}
