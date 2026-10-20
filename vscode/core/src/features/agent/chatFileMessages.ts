import {
  ChatMessageType,
  type ChatMessage,
  type ModifiedFileMessageValue,
} from "@editor-extensions/shared";

/**
 * Record a routed file change in the chat.
 *
 * An agent can edit the same file more than once in a turn (the file tracker
 * reports every change, not just the first). While the earlier ModifiedFile
 * message for that path is still undecided it is updated in place so the chat
 * shows one entry with the latest diff; once the user has acted on it a new
 * edit gets its own message.
 *
 * Returns the message token that now carries the change.
 */
export function upsertModifiedFileMessage(
  chatMessages: ChatMessage[],
  value: ModifiedFileMessageValue,
  newMessageToken: string,
  timestamp: string,
): string {
  for (let i = chatMessages.length - 1; i >= 0; i--) {
    const msg = chatMessages[i];
    if (msg.kind !== ChatMessageType.ModifiedFile) {
      continue;
    }
    const existing = msg.value as ModifiedFileMessageValue;
    if (existing.path !== value.path) {
      continue;
    }
    if (existing.status) {
      // Already applied/rejected: leave history alone and add a new entry.
      break;
    }
    msg.value = { ...existing, ...value };
    msg.timestamp = timestamp;
    return msg.messageToken;
  }

  chatMessages.push({
    kind: ChatMessageType.ModifiedFile,
    messageToken: newMessageToken,
    timestamp,
    value,
  });
  return newMessageToken;
}
