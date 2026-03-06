import * as vscode from "vscode";
import { EXTENSION_NAME } from "./constants";

const GOOSE_CREDENTIALS_KEY = `${EXTENSION_NAME}.goose.credentials`;

/**
 * Save goose provider credentials to VS Code Secret Storage.
 * Credentials are stored as a JSON map of env var names to values,
 * e.g. { "OPENAI_API_KEY": "sk-..." }
 */
export async function saveGooseCredentials(
  context: vscode.ExtensionContext,
  credentials: Record<string, string>,
): Promise<void> {
  await context.secrets.store(GOOSE_CREDENTIALS_KEY, JSON.stringify(credentials));
}

/**
 * Load goose provider credentials from VS Code Secret Storage.
 */
export async function loadGooseCredentials(
  context: vscode.ExtensionContext,
): Promise<Record<string, string> | undefined> {
  const stored = await context.secrets.get(GOOSE_CREDENTIALS_KEY);
  if (!stored) {
    return undefined;
  }

  try {
    return JSON.parse(stored) as Record<string, string>;
  } catch (error) {
    console.error("Failed to parse goose credentials from secrets:", error);
    return undefined;
  }
}

/**
 * Delete goose provider credentials from VS Code Secret Storage.
 */
export async function deleteGooseCredentials(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(GOOSE_CREDENTIALS_KEY);
}

/**
 * Check whether any goose credentials are stored.
 */
export async function hasGooseCredentials(context: vscode.ExtensionContext): Promise<boolean> {
  const stored = await context.secrets.get(GOOSE_CREDENTIALS_KEY);
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
