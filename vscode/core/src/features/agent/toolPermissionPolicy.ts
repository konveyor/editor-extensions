import type { PermissionOption } from "../../client/agentBackendClient";

// ─── Read-only detection ─────────────────────────────────────────────

const READ_ONLY_COMMANDS = new Set(["view", "undo_edit"]);

/**
 * Returns true when the tool call is provably read-only based on its rawInput.
 * Currently checks for Text Editor read commands (e.g. "view", "undo_edit").
 */
export function isReadOnlyToolCall(rawInput?: Record<string, unknown>): boolean {
  const command = rawInput?.command;
  return typeof command === "string" && READ_ONLY_COMMANDS.has(command.toLowerCase());
}

// ─── Option helpers ─────────────────────────────────────────────────

/**
 * Finds the "allow_once" option from a permission request's options list.
 * Used for auto-approval of read-only tool calls.
 */
export function findAllowOnceOptionId(options: PermissionOption[]): string | undefined {
  return options.find((opt) => opt.kind === "allow_once")?.optionId;
}

/**
 * Filters permission options to only show "Allow" and "Reject" (once).
 * "Always Allow" and "Always Reject" are hidden — permanent policy
 * should be configured through the agent's native config.
 */
export function filterPermissionOptions(options: PermissionOption[]): PermissionOption[] {
  return options.filter((opt) => opt.kind === "allow_once" || opt.kind === "reject_once");
}
