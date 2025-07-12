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
  // Special handling for different message types - NO generic duplicate check first
  switch (msg.type) {
    case KaiWorkflowMessageType.LLMResponseChunk: {
      // For LLM chunks, we only check for duplicates if it's a new message
      if (msg.id !== lastMessageId) {
        // Check if we've already started a message with this ID
        if (processedTokens.has(`llm-start:${msg.id}`)) {
          console.log(`Skipping duplicate LLM chunk message with ID: ${msg.id}`);
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
      console.log(`Processing file modification with key: ${fileKey}`);

      // Check if this specific file modification has already been processed
      if (processedTokens.has(fileKey)) {
        console.log(`HAS DUPE ${fileKey}`);
        // return false;
      }

      // Mark this file modification as processed
      processedTokens.add(fileKey);
      return true;
    }
    case KaiWorkflowMessageType.ToolCall: {
      // For tool calls, create a unique key based on tool name and status
      const toolName = msg.data.name || "unnamed tool";
      const toolStatus = msg.data.status;
      const toolKey = `tool:${toolName}:${toolStatus}:${msg.id}`;

      if (processedTokens.has(toolKey)) {
        console.log(`Skipping duplicate tool call message with key: ${toolKey}`);
        return false;
      }

      processedTokens.add(toolKey);
      return true;
    }
    case KaiWorkflowMessageType.UserInteraction: {
      // For user interactions, create a unique key based on the interaction type
      const interaction = msg.data as KaiUserInteraction;
      const interactionKey = `interaction:${interaction.type}:${msg.id}`;

      if (processedTokens.has(interactionKey)) {
        console.log(`Skipping duplicate user interaction message with key: ${interactionKey}`);
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
