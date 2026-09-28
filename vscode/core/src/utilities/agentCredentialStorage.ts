import * as vscode from "vscode";
import { EXTENSION_NAME } from "./constants";

// The SecretStorage key is shared across backends — credentials
// (API keys, etc.) are not backend-specific.
const AGENT_CREDENTIALS_KEY = `${EXTENSION_NAME}.goose.credentials`;

/**
 * Save agent provider credentials to VS Code Secret Storage.
 * Credentials are stored as a JSON map of env var names to values,
 * e.g. { "OPENAI_API_KEY": "sk-..." }
 */
export async function saveAgentCredentials(
  context: vscode.ExtensionContext,
  credentials: Record<string, string>,
): Promise<void> {
  await context.secrets.store(AGENT_CREDENTIALS_KEY, JSON.stringify(credentials));
}

/**
 * Load agent provider credentials from VS Code Secret Storage.
 */
export async function loadAgentCredentials(
  context: vscode.ExtensionContext,
): Promise<Record<string, string> | undefined> {
  const stored = await context.secrets.get(AGENT_CREDENTIALS_KEY);
  if (!stored) {
    return undefined;
  }

  try {
    return JSON.parse(stored) as Record<string, string>;
  } catch (error) {
    console.error("Failed to parse agent credentials from secrets:", error);
    return undefined;
  }
}

/**
 * Delete agent provider credentials from VS Code Secret Storage.
 */
export async function deleteAgentCredentials(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(AGENT_CREDENTIALS_KEY);
}

/**
 * Check whether any agent credentials are stored.
 */
export async function hasAgentCredentials(context: vscode.ExtensionContext): Promise<boolean> {
  const stored = await context.secrets.get(AGENT_CREDENTIALS_KEY);
  if (!stored) {
    return false;
  }
  try {
    const parsed = JSON.parse(stored) as Record<string, string>;
    return Object.keys(parsed).length > 0;
  } catch {
    return false;
  }
}
