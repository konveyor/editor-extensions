/**
 * Adapter to connect the vertical diff system with the existing webview message handler
 * This bridges Continue's webview protocol pattern with our webview system
 */

import * as vscode from "vscode";
import { ExtensionState } from "../extensionState";
import winston from "winston";

export interface WebviewProtocolAdapter {
  request(method: string, params: any): Promise<void>;
}

export class KonveyorWebviewProtocol implements WebviewProtocolAdapter {
  constructor(
    private state: ExtensionState,
    private logger: winston.Logger,
  ) {}

  async request(method: string, params: any): Promise<void> {
    this.logger.debug(`Webview protocol request: ${method}`, params);

    switch (method) {
      case "updateApplyState":
        // Handle diff state updates
        await this.updateApplyState(params);
        break;

      default:
        this.logger.warn(`Unknown webview protocol method: ${method}`, params);
    }
  }

  private async updateApplyState(params: {
    streamId?: string;
    status?: string;
    numDiffs?: number;
    fileContent?: string;
    filepath?: string;
    toolCallId?: string;
  }) {
    const { status, numDiffs, filepath } = params;

    // Log the status update
    this.logger.info(`Diff status update for ${filepath}: ${status} (${numDiffs} diffs)`);

    // Update VS Code context to show/hide diff UI elements
    if (status === "streaming" || status === "done") {
      await vscode.commands.executeCommand("setContext", "konveyor.diffVisible", true);
    } else if (status === "closed") {
      await vscode.commands.executeCommand("setContext", "konveyor.diffVisible", false);
    }

    // If we have an active resolution panel, send the update
    const resolutionProvider = this.state.webviewProviders?.get("resolution");
    if (resolutionProvider && params.streamId) {
      // Send a message to the webview about the diff state
      // This could be used to show progress or status in the UI
      this.state.mutateData((draft) => {
        // You could track diff states here if needed
        // For example, storing which files have active diffs
      });
    }
  }
}
