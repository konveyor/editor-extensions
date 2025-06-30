/**
 * Determines if a message should be processed or skipped as a duplicate
 * This provides a centralized way to handle duplicate detection across all message types
 */

import {
  KaiWorkflowMessage,
  KaiWorkflowMessageType,
  KaiModifiedFile,
  KaiUserIteraction,
} from "@editor-extensions/agentic";

export const shouldProcessMessage = (
  msg: KaiWorkflowMessage,
  lastMessageId: string | null,
  processedTokens: Set<string>,
): boolean => {
  // Special handling for different message types - NO generic duplicate check first
  switch (msg.type) {
    case KaiWorkflowMessageType.LLMResponseChunk: {
      // For LLM chunks, we only check for duplicates if it's a new message
      if (msg.id !== lastMessageId) {
        // Check if we've already started a message with this ID
        if (processedTokens.has(`llm-start:${msg.id}`)) {
          console.log(`Skipping duplicate LLM start message: ${msg.id}`);
          return false;
        }
        // Mark this message as started
        processedTokens.add(`llm-start:${msg.id}`);
      }
      // Don't add message ID to processedTokens for LLM chunks
      // as we want to allow multiple chunks with the same ID
      return true;
    }
    case KaiWorkflowMessageType.ModifiedFile: {
      const { path: filePath } = msg.data as KaiModifiedFile;
      // Create a unique key for this file modification
      const fileKey = `file:${filePath}:${msg.id}`;

      // Check if we've already processed a message for this file path and ID
      if (processedTokens.has(fileKey)) {
        console.log(`Skipping duplicate file modification for: ${filePath}`);
        return false;
      }

      // Also check if we've already processed ANY message for this file path
      // This prevents multiple different messages modifying the same file
      const filePathKey = `file:${filePath}`;
      if (processedTokens.has(filePathKey)) {
        console.log(
          `Skipping duplicate file modification for path: ${filePath} (different message ID)`,
        );
        return false;
      }

      // Mark this specific file modification as processed
      processedTokens.add(fileKey);
      // Also mark the file path as processed to prevent other messages from modifying it
      processedTokens.add(filePathKey);
      return true;
    }
    case KaiWorkflowMessageType.ToolCall: {
      // For tool calls, create a unique key based on tool name and status
      const toolName = msg.data.name || "unnamed tool";
      const toolStatus = msg.data.status;
      const toolKey = `tool:${toolName}:${toolStatus}:${msg.id}`;

      if (processedTokens.has(toolKey)) {
        console.log(`Skipping duplicate tool call: ${toolName} (${toolStatus})`);
        return false;
      }

      processedTokens.add(toolKey);
      return true;
    }
    case KaiWorkflowMessageType.UserInteraction: {
      // For user interactions, create a unique key based on the interaction type
      const interaction = msg.data as KaiUserIteraction;
      const interactionKey = `interaction:${interaction.type}:${msg.id}`;

      if (processedTokens.has(interactionKey)) {
        console.log(`Skipping duplicate user interaction: ${interaction.type}`);
        return false;
      }

      processedTokens.add(interactionKey);
      return true;
    }
    default: {
      // For all other message types, use basic duplicate check by message ID
      if (processedTokens.has(msg.id)) {
        console.log(`Skipping duplicate message with ID: ${msg.id}`);
        return false;
      }
      processedTokens.add(msg.id);
      return true;
    }
  }
};
