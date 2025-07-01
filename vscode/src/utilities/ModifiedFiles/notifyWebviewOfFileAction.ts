import { ChatMessageType } from "@editor-extensions/shared";
import { ExtensionState } from "src/extensionState";
import * as vscode from "vscode";
import { commands } from "vscode";

export async function notifyWebviewOfFileAction(
  state: ExtensionState,
  payload: {
    path: string;
    action: string; // Action can be "applied" or "rejected"
    messageToken?: string; // Optional token to identify the message
  },
): Promise<void> {
  try {
    const messageIndex = state.data.chatMessages.findIndex(
      (msg) =>
        msg.kind === ChatMessageType.ModifiedFile &&
        (msg.value as any).path === payload.path &&
        !(msg.value as any).status, // Only match messages without a status (pending)
    );

    // Update the modifiedFiles state based on the action
    if (payload.action === "applied") {
      // When changes are applied, remove the file from modifiedFiles or mark it as applied
      state.modifiedFiles.delete(payload.path);
    } else if (payload.action === "rejected") {
      // When changes are rejected, we can also remove it from modifiedFiles
      state.modifiedFiles.delete(payload.path);
    }

    // Update the UI state to reflect the action
    state.mutateData((draft) => {
      // Add a message indicating the action taken
      draft.chatMessages.push({
        kind: ChatMessageType.String,
        messageToken: `action-${Date.now()}`,
        timestamp: new Date().toISOString(),
        value: {
          message:
            payload.action === "applied"
              ? `Changes to ${payload.path} were applied from the editor.`
              : `Changes to ${payload.path} were rejected from the editor.`,
        },
      });

      // Update the status of the modified file message if found
      if (messageIndex !== -1) {
        const msg = draft.chatMessages[messageIndex];
        if (msg.kind === ChatMessageType.ModifiedFile) {
          (msg.value as any).status = payload.action;
        }
      }
    });

    // Resolve any pending interaction if messageToken is provided or found by path
    if (messageIndex !== -1 && state.resolvePendingInteraction) {
      const msg = state.data.chatMessages[messageIndex];
      if (msg && msg.messageToken) {
        const resolved = state.resolvePendingInteraction(msg.messageToken, {
          action: payload.action,
        });
        if (resolved) {
          console.log(
            `Resolved pending interaction for message token: ${msg.messageToken} with action: ${payload.action}`,
          );
        } else {
          console.log(`No pending interaction found for message token: ${msg.messageToken}`);
        }
      }
    }

    // If the action was 'applied', we need to update the file
    if (payload.action === "applied" && messageIndex !== -1) {
      // const msg = state.data.chatMessages[messageIndex];
      // const content = (msg.value as any).content;
      // if (content) {
      //   const uri = vscode.Uri.file(payload.path);
      //   await vscode.workspace.fs.writeFile(uri, new Uint8Array(Buffer.from(content)));
      //   vscode.window.showInformationMessage(
      //     `Changes applied to ${vscode.workspace.asRelativePath(uri)}`,
      //   );
      // }
    }
    // Ensure the resolution view is in focus after processing the action
    await commands.executeCommand("konveyor.showResolutionPanel");
  } catch (error) {
    console.error("Error handling FILE_ACTION:", error);
    vscode.window.showErrorMessage(`Failed to process file action: ${error}`);
  }
}
