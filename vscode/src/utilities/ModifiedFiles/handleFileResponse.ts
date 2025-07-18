import { ExtensionState } from "../../extensionState";
import * as vscode from "vscode";
import { ChatMessageType } from "@editor-extensions/shared";
import { getConfigAgentMode } from "../configuration";

/**
 * Creates a new file with the specified content
 */
const createNewFile = async (
  uri: vscode.Uri,
  filePath: string,
  content: string,
  state: ExtensionState,
): Promise<void> => {
  try {
    console.log(`Creating new file at ${filePath}`);
    // Ensure the directory structure exists
    const directoryPath = filePath.substring(0, filePath.lastIndexOf("/"));
    if (directoryPath) {
      const directoryUri = vscode.Uri.file(directoryPath);
      try {
        await vscode.workspace.fs.createDirectory(directoryUri);
      } catch (dirError) {
        console.error(`Failed to create directory at ${directoryPath}:`, dirError);
      }
    }
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
    vscode.window.showInformationMessage(
      `Created new file ${vscode.workspace.asRelativePath(uri)}`,
    );
  } catch (error) {
    console.error(`Failed to create file at ${filePath}:`, error);
    throw new Error(`Failed to create file: ${error}`);
  }
};

/**
 * Updates an existing file with new content
 */
const updateExistingFile = async (
  uri: vscode.Uri,
  filePath: string,
  content: string,
  state: ExtensionState,
): Promise<void> => {
  try {
    console.log(`Updating file at ${filePath}`);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
    vscode.window.showInformationMessage(`Updated file ${vscode.workspace.asRelativePath(uri)}`);
  } catch (error) {
    console.error(`Failed to update file at ${filePath}:`, error);
    throw new Error(`Failed to update file: ${error}`);
  }
};

/**
 * Deletes a file if it exists
 */
const deleteFile = async (
  uri: vscode.Uri,
  filePath: string,
  state: ExtensionState,
): Promise<void> => {
  try {
    let fileExists = false;
    try {
      await vscode.workspace.fs.stat(uri);
      fileExists = true;
    } catch (statError) {
      console.log(`File at ${filePath} does not exist or cannot be accessed`);
      fileExists = false;
    }

    if (fileExists) {
      console.log(`Deleting file at ${filePath}`);
      await vscode.workspace.fs.delete(uri);
      vscode.window.showInformationMessage(`Deleted file ${vscode.workspace.asRelativePath(uri)}`);
    } else {
      console.log(`File at ${filePath} does not exist, skipping deletion`);
    }
  } catch (error) {
    console.error(`Failed to delete file at ${filePath}:`, error);
    throw new Error(`Failed to delete file: ${error}`);
  }
};

export async function handleFileResponse(
  messageToken: string,
  responseId: string,
  path: string,
  content: string | undefined,
  state: ExtensionState,
): Promise<void> {
  try {
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

      if (responseId === "apply") {
        const uri = vscode.Uri.file(path);
        const fileMessage = state.data.chatMessages.find(
          (msg) =>
            msg.kind === ChatMessageType.ModifiedFile &&
            msg.messageToken === messageToken &&
            (msg.value as any).path === path,
        );

        if (!fileMessage) {
          throw new Error(`No changes found for file: ${path}`);
        }

        const fileValue = fileMessage.value as any;
        const isNew = fileValue.isNew;
        const isDeleted = fileValue.isDeleted;

        const fileContent = content || fileValue.content;

        try {
          if (isDeleted) {
            console.log(`Deleting file at ${path}`);
            await deleteFile(uri, path, state);
          } else if (isNew) {
            console.log(`Creating new file at ${path}`);
            await createNewFile(uri, path, fileContent, state);
          } else {
            console.log(`Updating existing file at ${path}`);
            await updateExistingFile(uri, path, fileContent, state);
          }

          // Trigger analysis after file changes are applied in agentic mode
          // This ensures that the tasks interaction can detect new diagnostic issues
          if (getConfigAgentMode()) {
            console.log(`Triggering analysis after applying changes to ${path}`);
            try {
              await state.analyzerClient.runAnalysis([uri]);
            } catch (analysisError) {
              console.warn(
                `Failed to trigger analysis after applying changes to ${path}:`,
                analysisError,
              );
              // Don't throw here - file changes were successful, analysis failure is not critical
            }
          }
        } catch (error) {
          console.error("Error applying file changes:", error);
          vscode.window.showErrorMessage(`Failed to apply changes: ${error}`);
          throw error;
        }
      }

      // Trigger the pending interaction resolver which will handle queue processing
      // and reset isWaitingForUserInteraction through the centralized handleUserInteractionComplete
      console.log(`Attempting to resolve pending interaction for messageToken: ${messageToken}`);
      if (state.resolvePendingInteraction) {
        const resolved = state.resolvePendingInteraction(messageToken, {
          responseId: responseId,
          path: path,
        });

        if (!resolved) {
          console.warn(`No pending interaction found for messageToken: ${messageToken}`);
          // As a fallback, reset the waiting flag if no pending interaction was found
          // This should rarely happen if the architecture is working correctly
          state.isWaitingForUserInteraction = false;
        } else {
          console.log(
            `Successfully resolved pending interaction for messageToken: ${messageToken}`,
          );
        }
      } else {
        console.warn(
          "resolvePendingInteraction function not available - this indicates a setup issue",
        );
        // As a fallback, reset the waiting flag
        state.isWaitingForUserInteraction = false;
      }
    } finally {
      console.log("Clearing loading state after file response handling");
    }
  } catch (error) {
    console.error("Error handling file response:", error);
    vscode.window.showErrorMessage("An error occurred while processing the file response.");
    throw error;
  }
}
