import { ExtensionState } from "../../extensionState";
import * as vscode from "vscode";
import { ChatMessageType } from "@editor-extensions/shared";
import { getConfigAgentMode, getConfigAnalyzeOnSave } from "../configuration";
import { executeExtensionCommand } from "../../commands";

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
    // Ensure the directory structure exists
    const directoryPath = filePath.substring(0, filePath.lastIndexOf("/"));
    if (directoryPath) {
      const directoryUri = vscode.Uri.file(directoryPath);
      try {
        await vscode.workspace.fs.createDirectory(directoryUri);
      } catch (dirError) {
        state.logger
          .child({ component: "handleFileResponse.createNewFile" })
          .error(`Failed to create directory at ${directoryPath}:`, dirError);
      }
    }
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
    vscode.window.showInformationMessage(
      `Created new file ${vscode.workspace.asRelativePath(uri)}`,
    );
  } catch (error) {
    state.logger
      .child({ component: "handleFileResponse.createNewFile" })
      .error(`Failed to create file at ${filePath}:`, error);
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
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
    vscode.window.showInformationMessage(`Updated file ${vscode.workspace.asRelativePath(uri)}`);
  } catch (error) {
    state.logger
      .child({ component: "handleFileResponse.updateExistingFile" })
      .error(`Failed to update file at ${filePath}:`, error);
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
      state.logger
        .child({ component: "handleFileResponse.deleteFile" })
        .warn(`File at ${filePath} does not exist or cannot be accessed`, statError);
      fileExists = false;
    }

    if (fileExists) {
      await vscode.workspace.fs.delete(uri);
      vscode.window.showInformationMessage(`Deleted file ${vscode.workspace.asRelativePath(uri)}`);
    }
  } catch (error) {
    state.logger
      .child({ component: "handleFileResponse.deleteFile" })
      .error(`Failed to delete file at ${filePath}:`, error);
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
  const logger = state.logger.child({ component: "handleFileResponse.handleFileResponse" });
  try {
    const messageIndex = state.data.chatMessages.findIndex(
      (msg) => msg.messageToken === messageToken,
    );

    if (messageIndex === -1) {
      state.logger
        .child({ component: "handleFileResponse.handleFileResponse" })
        .error("Message token not found:", messageToken);
      return;
    }

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
          await deleteFile(uri, path, state);
        } else if (isNew) {
          await createNewFile(uri, path, fileContent, state);
        } else {
          await updateExistingFile(uri, path, fileContent, state);
        }

        // Trigger analysis after file changes are applied in agentic mode or when analyze on save is enabled
        // This ensures that the tasks interaction can detect new diagnostic issues
        if (getConfigAgentMode() || getConfigAnalyzeOnSave()) {
          try {
            await state.analyzerClient.runAnalysis([uri]);
          } catch (analysisError) {
            logger.warn(
              `Failed to trigger analysis after applying changes to ${path}:`,
              analysisError,
            );
            // Don't throw here - file changes were successful, analysis failure is not critical
          }
        }
      } catch (error) {
        logger.error("Error applying file changes:", error);
        vscode.window.showErrorMessage(`Failed to apply changes: ${error}`);
        throw error;
      }

      // Notify solution server of the change
      try {
        if (isDeleted) {
          await executeExtensionCommand("changeDiscarded", path);
        } else {
          await executeExtensionCommand("changeApplied", path, fileContent);
        }
      } catch (error) {
        logger.error("Error notifying solution server:", error);
      }

      // Update the chat message status in the centralized state (for Accept/Reject All consistency)
      state.mutateData((draft) => {
        const messageIndex = draft.chatMessages.findIndex(
          (msg) => msg.messageToken === messageToken,
        );
        if (
          messageIndex >= 0 &&
          draft.chatMessages[messageIndex].kind === ChatMessageType.ModifiedFile
        ) {
          const modifiedFileMessage = draft.chatMessages[messageIndex].value as any;
          modifiedFileMessage.status = "applied";
        }
      });
    } else {
      // For reject, also update the global state
      state.mutateData((draft) => {
        const messageIndex = draft.chatMessages.findIndex(
          (msg) => msg.messageToken === messageToken,
        );
        if (
          messageIndex >= 0 &&
          draft.chatMessages[messageIndex].kind === ChatMessageType.ModifiedFile
        ) {
          const modifiedFileMessage = draft.chatMessages[messageIndex].value as any;
          modifiedFileMessage.status = "rejected";
        }
      });
    }

    // Trigger the pending interaction resolver which will handle queue processing
    // and reset isWaitingForUserInteraction through the centralized handleUserInteractionComplete
    if (state.resolvePendingInteraction) {
      const resolved = state.resolvePendingInteraction(messageToken, {
        responseId: responseId,
        path: path,
      });

      if (!resolved) {
        logger.warn(`No pending interaction found for messageToken: ${messageToken}`);
        // As a fallback, reset the waiting flag if no pending interaction was found
        // This should rarely happen if the architecture is working correctly
        state.mutateData((draft) => {
          draft.isWaitingForUserInteraction = false;
        });
      }
    } else {
      logger.warn(
        "resolvePendingInteraction function not available - this indicates a setup issue",
      );
      // As a fallback, reset the waiting flag
      state.mutateData((draft) => {
        draft.isWaitingForUserInteraction = false;
      });
    }
  } catch (error) {
    logger.error("Error handling file response:", error);
    vscode.window.showErrorMessage(`Failed to handle file response: ${error}`);
    throw error;
  }
}
