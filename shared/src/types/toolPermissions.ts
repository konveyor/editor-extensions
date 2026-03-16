/** Tool categories — the common denominator across all agent backends */
export type ToolCategory =
  | "fileEditing" // create, modify, delete files
  | "commandExecution" // bash/shell commands
  | "webAccess" // fetch URLs, web search
  | "mcpTools" // third-party MCP tool servers
  | "other"; // uncategorized / read-only

/** Per-category permission level */
export type ToolPermissionLevel = "auto" | "ask" | "deny";

/**
 * Generic tool permission policy that works across agent backends
 * (Goose, OpenCode, Claude Code, Codex).
 *
 * The extension owns this policy and translates it into backend-specific
 * configuration (GOOSE_MODE, OpenCode permission block, etc.).
 * The hub can push org-level policies with `source: "hub"`.
 */
export interface ToolPermissionPolicy {
  /** Global default autonomy level for all tool categories */
  autonomyLevel: "auto" | "smart" | "ask";
  /** Per-category overrides — absent keys inherit from autonomyLevel */
  overrides?: Partial<Record<Exclude<ToolCategory, "other">, ToolPermissionLevel>>;
  /** Where this policy came from */
  source?: "local" | "hub";
}

/** Default policy: smart mode, no per-category overrides */
export const DEFAULT_TOOL_PERMISSION_POLICY: ToolPermissionPolicy = {
  autonomyLevel: "smart",
  source: "local",
};
