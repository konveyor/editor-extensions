import * as vscode from "vscode";
import { getConfigSolutionServerAuth } from "./configuration";
import { Logger } from "winston";
import { KeycloakCredentials } from "@editor-extensions/shared";
const AUTH_DATA_KEY = "konveyor.solutionServer.authData";

/**
 * Prompt user for authentication credentials
 */
export async function promptForCredentials(
  context: vscode.ExtensionContext,
): Promise<KeycloakCredentials | undefined> {
  const username = await vscode.window.showInputBox({
    prompt: "Enter username for solution server",
    ignoreFocusOut: true,
  });

  if (!username) {
    return undefined;
  }

  const password = await vscode.window.showInputBox({
    prompt: "Enter password for solution server",
    password: true,
    ignoreFocusOut: true,
  });

  if (!password) {
    return undefined;
  }

  await storeCredentials(context, { username, password });
  return { username, password };
}

/**
 * Store credentials in VS Code's secure secret storage
 */
export async function storeCredentials(
  context: vscode.ExtensionContext,
  credentials: KeycloakCredentials,
): Promise<void> {
  await context.secrets.store(AUTH_DATA_KEY, JSON.stringify(credentials));
}

/**
 * Retrieve stored credentials from VS Code's secure secret storage
 */
export async function getStoredCredentials(
  context: vscode.ExtensionContext,
  logger?: Logger,
): Promise<KeycloakCredentials | undefined> {
  try {
    const stored = await context.secrets.get(AUTH_DATA_KEY);
    if (!stored) {
      return undefined;
    }
    return JSON.parse(stored) as KeycloakCredentials;
  } catch (error) {
    if (logger) {
      logger.error("Error getting stored credentials", error);
    }
    return undefined;
  }
}

/**
 * Clear stored credentials from VS Code's secure secret storage
 */
export async function clearCredentials(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(AUTH_DATA_KEY);
}

/**
 * Check if credentials are stored
 */
export async function hasStoredCredentials(
  context: vscode.ExtensionContext,
  logger?: Logger,
): Promise<boolean> {
  const credentials = await getStoredCredentials(context, logger);
  return credentials !== undefined;
}

/**
 * Check if auth is enabled but credentials are missing, and prompt user to configure them
 */
export async function checkAndPromptForCredentials(
  context: vscode.ExtensionContext,
  logger?: Logger,
): Promise<KeycloakCredentials | undefined> {
  if (!getConfigSolutionServerAuth()) {
    return undefined;
  }

  const credentials = await getStoredCredentials(context, logger);
  if (credentials) {
    return credentials;
  }

  return await promptForCredentials(context);
}
