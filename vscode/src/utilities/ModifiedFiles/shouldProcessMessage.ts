/**
 * Determines if a message should be processed or skipped as a duplicate
 * This provides a centralized way to handle duplicate detection across all message types
 */

import {
  KaiWorkflowMessage,
  KaiWorkflowMessageType,
  KaiModifiedFile,
  KaiUserInteraction,
} from "@editor-extensions/agentic";

export const shouldProcessMessage = (
  msg: KaiWorkflowMessage,
  lastMessageId: string | null,
  processedTokens: Set<string>,
): boolean => {
  // Special handling for different message types
  switch (msg.type) {
    case KaiWorkflowMessageType.LLMResponseChunk: {
      // For LLM chunks, we need to track individual chunks to prevent exact duplicates
      // but allow multiple chunks with the same message ID (which is normal)
      const chunkKey = `llm-chunk:${msg.id}:${JSON.stringify(msg.data)}`;

      // Mark this specific chunk as processed
      processedTokens.add(chunkKey);
      return true;
    }
    case KaiWorkflowMessageType.ModifiedFile: {
      const { path: filePath } = msg.data as KaiModifiedFile;
      // Create a unique key for this file modification
      const fileKey = `file:${filePath}:${msg.id}`;

      // Check if this specific file modification has already been processed
      if (processedTokens.has(fileKey)) {
        return false;
      }

      // Mark this file modification as processed
      processedTokens.add(fileKey);
      return true;
    }
    case KaiWorkflowMessageType.ToolCall: {
      // For tool calls, create a unique key based on tool name, status, and the specific data
      const toolName = msg.data.name || "unnamed tool";
      const toolStatus = msg.data.status;
      const toolData = JSON.stringify(msg.data);
      const toolKey = `tool:${toolName}:${toolStatus}:${toolData}`;

      if (processedTokens.has(toolKey)) {
        return false;
      }

      processedTokens.add(toolKey);
      return true;
    }
    case KaiWorkflowMessageType.UserInteraction: {
      // For user interactions, create a unique key based on the interaction type and data
      const interaction = msg.data as KaiUserInteraction;

      // Special handling for tasks interactions - use message ID to allow multiple tasks interactions
      if (interaction.type === "tasks") {
        const tasksKey = `interaction:tasks:${msg.id}`;

        if (processedTokens.has(tasksKey)) {
          return false;
        }

        processedTokens.add(tasksKey);
        return true;
      }

      // For other interaction types, use the original logic
      const interactionData = JSON.stringify(msg.data);
      const interactionKey = `interaction:${interaction.type}:${interactionData}`;

      if (processedTokens.has(interactionKey)) {
        return false;
      }

      processedTokens.add(interactionKey);
      return true;
    }
    default: {
      // For all other message types, use basic duplicate check by message ID
      if (processedTokens.has(msg.id)) {
        return false;
      }
      processedTokens.add(msg.id);
      return true;
    }
  }
};
