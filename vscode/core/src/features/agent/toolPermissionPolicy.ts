import type { ToolPermissionPolicy, ToolPermissionLevel } from "@editor-extensions/shared";
import type { PermissionRequestData, PermissionOption } from "../../client/agentClient";
import { classifyTool } from "./toolClassifier";

// ─── Policy resolution ──────────────────────────────────────────────

/**
 * Resolve the effective permission level for a tool given the policy.
 *
 * Read-only operations (e.g. Text Editor "view") are always auto-approved
 * regardless of policy — they can't modify anything.
 *
 * Otherwise checks per-category overrides first, then falls back to the
 * global autonomy level. In "smart" mode, file editing and command
 * execution require approval while other tools are auto-approved.
 */
export function resolvePermission(
  policy: ToolPermissionPolicy,
  toolName: string,
  rawInput?: Record<string, unknown>,
): ToolPermissionLevel {
  const category = classifyTool(toolName, rawInput);

  if (isReadOnlyToolCall(rawInput)) {
    return "auto";
  }

  // Check per-category override first
  if (category !== "other" && policy.overrides?.[category]) {
    return policy.overrides[category]!;
  }

  // Harmless internal tools (e.g. Goose's "Todo Write") and our own
  // MCP tools (e.g. "Konveyor: Run Analysis") never need approval
  if (category === "other" || category === "mcpTools") {
    return "auto";
  }

  // Fall back to autonomy level
  switch (policy.autonomyLevel) {
    case "auto":
      return "auto";
    case "ask":
      return "ask";
    case "smart":
      // "smart" = auto for reads, ask for writes
      return category === "fileEditing" || category === "commandExecution" ? "ask" : "auto";
  }
}

const READ_ONLY_COMMANDS = new Set(["view", "undo_edit"]);

/**
 * Returns true when the tool call is provably read-only based on its rawInput.
 * Currently checks for Text Editor read commands (e.g. "view", "undo_edit").
 */
export function isReadOnlyToolCall(rawInput?: Record<string, unknown>): boolean {
  const command = rawInput?.command;
  return typeof command === "string" && READ_ONLY_COMMANDS.has(command.toLowerCase());
}

/**
 * Should a permission request be auto-approved given the current policy?
 *
 * Uses the tool classifier + policy to decide, rather than delegating
 * the classification to the backend.
 */
export function shouldAutoApproveWithPolicy(
  policy: ToolPermissionPolicy,
  data: PermissionRequestData,
): boolean {
  const level = resolvePermission(policy, data.toolName ?? data.title, data.rawInput);
  return level === "auto";
}

/**
 * Should a permission request be auto-denied given the current policy?
 */
export function shouldDenyWithPolicy(
  policy: ToolPermissionPolicy,
  data: PermissionRequestData,
): boolean {
  const level = resolvePermission(policy, data.toolName ?? data.title, data.rawInput);
  return level === "deny";
}

// ─── Option helpers ─────────────────────────────────────────────────

/**
 * Finds the "allow_once" option from a permission request's options list.
 * Used for auto-approval responses.
 */
export function findAllowOnceOptionId(options: PermissionOption[]): string | undefined {
  return options.find((opt) => opt.kind === "allow_once")?.optionId;
}

/**
 * Finds the "reject_once" option from a permission request's options list.
 * Used for auto-deny responses.
 */
export function findRejectOnceOptionId(options: PermissionOption[]): string | undefined {
  return options.find((opt) => opt.kind === "reject_once")?.optionId;
}

/**
 * Filters permission options to only show "Allow" and "Reject" (once).
 * "Always Allow" and "Always Reject" are confusing in the context of
 * a migration workflow — they'd silently change mode semantics.
 */
export function filterPermissionOptions(options: PermissionOption[]): PermissionOption[] {
  return options.filter((opt) => opt.kind === "allow_once" || opt.kind === "reject_once");
}

// ─── Backend adapters ───────────────────────────────────────────────

/**
 * Translate a generic ToolPermissionPolicy to Goose's GOOSE_MODE env var.
 *
 * Always returns "approve" so that Goose sends permission requests for
 * every tool call. The extension's own policy (autonomyLevel + per-category
 * overrides) is the single source of truth for auto-approve / deny / ask.
 *
 * Using Goose's "smart_approve" or "auto" modes would let Goose silently
 * approve tool calls that the extension's policy might want to prompt for
 * (or vice versa), creating a dual-layer permission problem.
 */
export function policyToGooseMode(_policy: ToolPermissionPolicy): string {
  return "approve";
}

/**
 * Translate a generic ToolPermissionPolicy to OpenCode's permission config.
 *
 * Maps each tool category to OpenCode's permission keys:
 *   fileEditing → "edit", commandExecution → "bash", webAccess → "webfetch"
 */
export function policyToOpencodePermissions(policy: ToolPermissionPolicy): Record<string, string> {
  const map = (level: ToolPermissionLevel): string => {
    switch (level) {
      case "auto":
        return "allow";
      case "deny":
        return "deny";
      case "ask":
        return "ask";
    }
  };

  return {
    edit: map(resolvePermission(policy, "edit")),
    bash: map(resolvePermission(policy, "bash")),
    webfetch: map(resolvePermission(policy, "webfetch")),
  };
}
