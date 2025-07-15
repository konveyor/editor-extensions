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
    console.log(
      "Queueing message for later processing:",
      message,
      message.data && typeof message.data === "object" && "content" in message.data
        ? message.data.content
        : undefined,
      message.data && typeof message.data === "object" && "path" in message.data
        ? message.data.path
        : undefined,
    );
    console.log(
      `Queue length before adding: ${this.messageQueue.length}, isProcessingQueue: ${this.isProcessingQueue}`,
    );
    this.messageQueue.push(message);
    console.log(`Queue length after adding: ${this.messageQueue.length}`);
  }

  /**
   * Checks if we should queue a message (only when waiting for user interaction)
   * We should NOT queue messages when we're processing the queue, as that would create an infinite loop
   */
  shouldQueueMessage(): boolean {
    return this.state.isWaitingForUserInteraction;
  }

  /**
   * Processes all queued messages
   * This is the generic queue processing logic that was previously tightly coupled to ModifiedFile handler
   * IMPORTANT: This method ensures queued messages are processed BEFORE any new incoming messages
   */
  async processQueuedMessages(): Promise<void> {
    // Prevent concurrent queue processing
    if (this.isProcessingQueue) {
      console.log("Queue processing already in progress, skipping");
      console.log(`Current queue length: ${this.messageQueue.length}`);
      return;
    }

    if (this.messageQueue.length === 0) {
      console.log("No messages in queue to process");
      return;
    }

    this.isProcessingQueue = true;
    console.log(`Starting to process ${this.messageQueue.length} queued messages`);

    try {
      // Create a copy of the current queue and clear the original
      const queuedMessages = [...this.messageQueue];
      this.messageQueue.length = 0;

      console.log(`Processing ${queuedMessages.length} queued messages`);

      // Process each message sequentially without any filtering or deduplication
      // All messages in the queue should be processed as they are
      for (let i = 0; i < queuedMessages.length; i++) {
        const queuedMsg = queuedMessages[i];
        console.log(
          `Processing queued message ${i + 1}/${queuedMessages.length}: ${queuedMsg.id} (${queuedMsg.type})`,
        );

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
          console.log(
            `Successfully processed queued message ${i + 1}/${queuedMessages.length}: ${queuedMsg.id}`,
          );
        } catch (error) {
          console.error(`Error processing queued message ${queuedMsg.id}:`, error);
          // Continue processing other messages even if one fails
        }
      }

      console.log("Finished processing queued messages");
      console.log(`Final queue length after processing: ${this.messageQueue.length}`);
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
      console.log("Queue processing flag reset to false");
    }
  }

  /**
   * Gets the current queue length
   */
  getQueueLength(): number {
    return this.messageQueue.length;
  }

  /**
   * Checks if the queue is currently being processed
   */
  isProcessingQueueActive(): boolean {
    return this.isProcessingQueue;
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
  console.log("User interaction complete, processing queued messages");
  console.log(`Queue length before processing: ${queueManager.getQueueLength()}`);

  // Reset the waiting flag
  state.isWaitingForUserInteraction = false;

  // Process any queued messages
  await queueManager.processQueuedMessages();

  console.log(`Queue processing completed`);
}
