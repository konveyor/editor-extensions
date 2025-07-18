import {
  KaiWorkflowMessage,
  KaiWorkflowMessageType,
  KaiUserInteraction,
} from "@editor-extensions/agentic";
import { ExtensionState } from "../../extensionState";
import * as vscode from "vscode";
export async function handleQuickResponse(
  messageToken: string,
  responseId: string,
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

      // // Handle custom quick responses for analysis actions
      // if (responseId === "run-analysis") {
      //   if (state.data.isAnalyzing) {
      //     vscode.window.showInformationMessage("Analysis is already running.");
      //     return;
      //   }
      //   await vscode.commands.executeCommand("konveyor.runAnalysis");
      //   await vscode.commands.executeCommand("konveyor.showAnalysisPanel");
      //   return;
      // }
      // if (responseId === "return-analysis") {
      //   await vscode.commands.executeCommand("konveyor.showAnalysisPanel");
      //   return;
      // }

      const msg = state.data.chatMessages[messageIndex];

      // // Add user's response to chat (only for actionable quick responses)
      // state.mutateData((draft) => {
      //   draft.chatMessages.push({
      //     kind: ChatMessageType.String,
      //     messageToken: msg.messageToken,
      //     timestamp: new Date().toISOString(),
      //     value: {
      //       message: responseId === "yes" ? "Yes" : responseId === "no" ? "No" : responseId,
      //     },
      //   });
      // });

      // Create the workflow message with proper typing
      let interactionType = responseId.startsWith("choice-") ? "choice" : "yesNo";
      let responseData: { choice: number } | { yesNo: boolean } | { tasks: any; yesNo: boolean } =
        responseId.startsWith("choice-")
          ? { choice: parseInt(responseId.split("-")[1]) }
          : { yesNo: responseId === "yes" };

      // Check if this message is related to "tasks" interaction by looking for tasksData in the message value
      if (msg.value && "tasksData" in msg.value) {
        interactionType = "tasks";
        responseData = {
          tasks: msg.value.tasksData,
          yesNo: responseId === "yes",
        };
      }

      const workflowMessage: KaiWorkflowMessage = {
        id: messageToken,
        type: KaiWorkflowMessageType.UserInteraction,
        data: {
          type: interactionType,
          response: responseData,
        } as KaiUserInteraction,
      };

      if (!state.workflowManager.isInitialized) {
        console.error("Workflow not initialized");
        return;
      }

      const workflow = state.workflowManager.getWorkflow();
      await workflow.resolveUserInteraction(workflowMessage);

      // Trigger the pending interaction resolver which will handle queue processing
      // and reset isWaitingForUserInteraction through the centralized handleUserInteractionComplete
      if (state.resolvePendingInteraction) {
        const resolved = state.resolvePendingInteraction(messageToken, {
          responseId: responseId,
          interactionType: interactionType,
        });

        if (!resolved) {
          console.warn(`No pending interaction found for messageToken: ${messageToken}`);
          // As a fallback, reset the waiting flag if no pending interaction was found
          // This should rarely happen if the architecture is working correctly
          state.isWaitingForUserInteraction = false;
        } else {
          console.log(`Successfully resolved interaction for messageToken: ${messageToken}`);
        }
      } else {
        console.warn(
          "resolvePendingInteraction function not available - this indicates a setup issue",
        );
        // As a fallback, reset the waiting flag
        state.isWaitingForUserInteraction = false;
      }

      // Only add the status message if there are more actionable quick responses
      // const hasPendingInteractions = state.data.chatMessages.some(
      //   (msg) =>
      //     msg.quickResponses &&
      //     msg.quickResponses.length > 0 &&
      //     msg.messageToken !== messageToken &&
      //     msg.quickResponses.some((qr) => qr.id !== "run-analysis" && qr.id !== "return-analysis"),
      // );

      // if (hasPendingInteractions) {
      //   state.mutateData((draft) => {
      //     draft.chatMessages.push({
      //       kind: ChatMessageType.String,
      //       messageToken: `queue-status-${Date.now()}`,
      //       timestamp: new Date().toISOString(),
      //       value: {
      //         message: "There are more pending responses needed.",
      //       },
      //     });
      //   });
      // }
      // Do NOT add a status message if there are no more actionable quick responses
    } finally {
      // Clear loading state
      console.log("Clearing loading state after quick response handling");
    }
  } catch (error) {
    console.error("Error handling quick response:", error);
    vscode.window.showErrorMessage("An error occurred while processing the quick response.");
  }
}
