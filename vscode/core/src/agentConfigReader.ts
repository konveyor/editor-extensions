import * as path from "path";
import type { AgentBackend, AgentConfig, AgentCapability } from "@editor-extensions/shared";
import { DEFAULT_TOOL_PERMISSION_POLICY } from "@editor-extensions/shared";
import { getConfigAgentBackend } from "./utilities/configuration";
import { readGooseConfig, writeGooseConfig, getGooseConfigPath } from "./gooseConfig";
import type { WriteGooseConfigChanges } from "./gooseConfig";

// ─── Backend-agnostic config API ────────────────────────────────────

export interface WriteAgentConfigChanges {
  provider?: string;
  model?: string;
  extensions?: Array<{ id: string; enabled: boolean }>;
}

/**
 * Read the active agent backend's configuration and return a
 * backend-agnostic AgentConfig for the UI.
 */
export function readAgentConfig(): AgentConfig {
  const backend = getConfigAgentBackend();
  switch (backend) {
    case "opencode":
      return readOpencodeConfig();
    default:
      return readGooseConfig();
  }
}

/**
 * Write configuration changes to the active agent backend's config file.
 */
export function writeAgentConfig(changes: WriteAgentConfigChanges): void {
  const backend = getConfigAgentBackend();
  switch (backend) {
    case "opencode":
      writeOpencodeConfig(changes);
      break;
    default:
      writeGooseConfig(changes as WriteGooseConfigChanges);
      break;
  }
}

/**
 * Return the path to the active agent backend's native config file.
 */
export function getAgentConfigPath(backend: AgentBackend, workspaceRoot?: string): string {
  switch (backend) {
    case "opencode":
      return path.join(workspaceRoot ?? ".", "opencode.json");
    default:
      return getGooseConfigPath();
  }
}

// ─── OpenCode config ────────────────────────────────────────────────

function readOpencodeConfig(): AgentConfig {
  const capabilities: AgentCapability[] = [];

  return {
    backend: "opencode",
    agentMode: true,
    provider: "",
    model: "",
    capabilities,
    hasStoredCredentials: false,
    toolPermissions: DEFAULT_TOOL_PERMISSION_POLICY,
  };
}

function writeOpencodeConfig(_changes: WriteAgentConfigChanges): void {
  // OpenCode manages its own config via the SDK / opencode.json.
  // Provider and model are set through environment variables and the
  // SDK's createOpencode() config, not through a user-editable YAML.
  // This is intentionally a no-op — config writes flow through
  // provider-settings.yaml and SecretStorage instead.
}
