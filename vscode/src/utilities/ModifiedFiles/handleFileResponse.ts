import { ExtensionState } from "../../extensionState";
import * as vscode from "vscode";
import { ChatMessageType } from "@editor-extensions/shared";

export async function handleFileResponse(
  messageToken: string,
  responseId: string,
  path: string,
  content: string | undefined,
  state: ExtensionState,
): Promise<void> {
  try {
    // Set loading state
    state.mutateData((draft) => {
      draft.isProcessingQuickResponse = true;
    });

    try {
      const messageIndex = state.data.chatMessages.findIndex(
        (msg) => msg.messageToken === messageToken,
      );

      if (messageIndex === -1) {
        console.error("Message token not found:", messageToken);
        return;
      }

      const msg = state.data.chatMessages[messageIndex];

      // Add user's response to chat
      state.mutateData((draft) => {
        draft.chatMessages.push({
          kind: ChatMessageType.String,
          messageToken: msg.messageToken,
          timestamp: new Date().toISOString(),
          value: {
            message: responseId === "apply" ? "Applied file changes" : "Rejected file changes",
          },
        });
      });

      // Handle the file response
      if (responseId === "apply") {
        // Apply the file changes directly
        const uri = vscode.Uri.file(path);

        try {
          // If content is provided directly, use it
          if (content) {
            // Directly write to the real file
            await vscode.workspace.fs.writeFile(uri, new Uint8Array(Buffer.from(content)));
            vscode.window.showInformationMessage(
              `Changes applied to ${vscode.workspace.asRelativePath(uri)}`,
            );
          } else {
            // Try to find the modified file message in chat messages
            const fileMessage = state.data.chatMessages.find(
              (msg) =>
                msg.kind === ChatMessageType.ModifiedFile && (msg.value as any).path === path,
            );

            if (fileMessage) {
              const content = (fileMessage.value as any).content;
              if (content) {
                // Write the content to the file
                await vscode.workspace.fs.writeFile(uri, new Uint8Array(Buffer.from(content)));
                vscode.window.showInformationMessage(
                  `Changes applied to ${vscode.workspace.asRelativePath(uri)}`,
                );
              } else {
                throw new Error(`No content found for file: ${path}`);
              }
            } else {
              throw new Error(`No changes found for file: ${path}`);
            }
          }
        } catch (error) {
          console.error("Error applying file changes:", error);
          vscode.window.showErrorMessage(`Failed to apply changes: ${error}`);
          // If there was an error applying changes, treat it as a rejection
          responseId = "reject";
        }
      } else {
        // For rejecting changes, we don't need to do anything since we're not
        // directly modifying the real file until the user applies changes
        vscode.window.showInformationMessage(
          `Changes rejected for ${vscode.workspace.asRelativePath(vscode.Uri.file(path))}`,
        );
      }

      // Resolve the pending interaction if one exists
      if (state.resolvePendingInteraction) {
        state.resolvePendingInteraction(messageToken, {
          action: responseId,
          path: path,
        });
      }

      // Check if there are any more pending interactions
      const hasPendingInteractions = state.data.chatMessages.some(
        (msg) =>
          msg.quickResponses && msg.quickResponses.length > 0 && msg.messageToken !== messageToken,
      );

      // Add a message indicating the queue status
      // state.mutateData((draft) => {
      //   draft.chatMessages.push({
      //     kind: ChatMessageType.String,
      //     messageToken: `queue-status-${Date.now()}`,
      //     timestamp: new Date().toISOString(),
      //     value: {
      //       message: hasPendingInteractions
      //         ? "There are more pending changes to review."
      //         : "All changes have been processed. You're up to date!",
      //     },
      //   });
      // });
    } finally {
      // Clear loading state
      state.mutateData((draft) => {
        draft.isProcessingQuickResponse = false;
      });
    }
  } catch (error) {
    console.error("Error handling file response:", error);
    vscode.window.showErrorMessage("An error occurred while processing the file response.");
  }
}
