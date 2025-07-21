import { KaiWorkflowMessage, KaiInteractiveWorkflow } from "@editor-extensions/agentic";
import { ExtensionState } from "src/extensionState";
import { ChatMessageType } from "@editor-extensions/shared";

/**
 * Centralized queue manager for handling message queuing and processing
 * This decouples queue processing from specific message types
 */
export class MessageQueueManager {
  private messageQueue: KaiWorkflowMessage[] = [];
  private isProcessingQueue = false;
  private isProcessingMessages = false; // Flag to prevent new messages during queue processing

  constructor(
    private state: ExtensionState,
    private workflow: KaiInteractiveWorkflow,
    private modifiedFilesPromises: Array<Promise<void>>,
    private processedTokens: Set<string>,
    private pendingInteractions: Map<string, (response: any) => void>,
    private maxTaskManagerIterations: number,
  ) {}

  /**
   * Adds a message to the queue
   */
  enqueueMessage(message: KaiWorkflowMessage): void {
    this.messageQueue.push(message);
  }

  /**
   * Checks if we should queue a message (only when waiting for user interaction)
   * We should NOT queue messages when we're processing the queue, as that would create an infinite loop
   */
  shouldQueueMessage(): boolean {
    return this.state.isWaitingForUserInteraction;
  }

  /**
   * Gets the current queue length for monitoring
   */
  getQueueLength(): number {
    return this.messageQueue.length;
  }

  /**
   * Checks if queue processing is currently active
   */
  isProcessingQueueActive(): boolean {
    return this.isProcessingQueue;
  }

  /**
   * Processes all queued messages
   * This is the generic queue processing logic that was previously tightly coupled to ModifiedFile handler
   * IMPORTANT: This method ensures queued messages are processed BEFORE any new incoming messages
   */
  async processQueuedMessages(): Promise<void> {
    // Prevent concurrent queue processing
    if (this.isProcessingQueue) {
      return;
    }

    if (this.messageQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      // Create a copy of the current queue and clear the original
      const queuedMessages = [...this.messageQueue];
      this.messageQueue.length = 0;

      // Log the types of messages being processed for debugging
      const messageTypes = queuedMessages.map((msg) => msg.type);

      // Process each message sequentially without any filtering or deduplication
      // All messages in the queue should be processed as they are
      for (let i = 0; i < queuedMessages.length; i++) {
        const queuedMsg = queuedMessages[i];

        try {
          // Dynamically import processMessage to avoid circular dependency
          const { processMessage } = await import("./processMessage");
          await processMessage(
            queuedMsg,
            this.state,
            this.workflow,
            this.messageQueue, // Pass the queue so new messages can be queued during processing
            this.modifiedFilesPromises,
            this.processedTokens,
            this.pendingInteractions,
            this.maxTaskManagerIterations,
            this, // Pass the queue manager itself
          );
        } catch (error) {
          console.error(`Error processing queued message ${queuedMsg.id}:`, error);
          // Continue processing other messages even if one fails
        }
      }
    } catch (error) {
      console.error("Error processing queued messages:", error);

      // Add an error indicator to the chat
      this.state.mutateData((draft) => {
        draft.chatMessages.push({
          kind: ChatMessageType.String,
          messageToken: `queue-error-${Date.now()}`,
          timestamp: new Date().toISOString(),
          value: {
            message: `Error processing queued messages: ${error}`,
          },
        });
      });
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Clears the queue (useful for cleanup)
   */
  clearQueue(): void {
    this.messageQueue.length = 0;
  }
}

/**
 * Generic function to handle the transition from waiting for user interaction to processing queued messages
 * This should be called whenever isWaitingForUserInteraction transitions from true to false
 */
export async function handleUserInteractionComplete(
  state: ExtensionState,
  queueManager: MessageQueueManager,
): Promise<void> {
  // Reset the waiting flag
  state.isWaitingForUserInteraction = false;

  // Process any queued messages
  if (queueManager.getQueueLength() > 0) {
    await queueManager.processQueuedMessages();
  } else {
    console.log(`No queued messages to process`);
  }
}
