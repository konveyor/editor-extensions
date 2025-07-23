import { KaiWorkflowMessage, KaiInteractiveWorkflow } from "@editor-extensions/agentic";
import { ExtensionState } from "src/extensionState";
import { ChatMessageType } from "@editor-extensions/shared";
import { shouldProcessMessage } from "./shouldProcessMessage";

/**
 * Centralized queue manager for handling message queuing and processing
 * Uses continuous background processing with flow control for streaming messages
 */
export class MessageQueueManager {
  private messageQueue: KaiWorkflowMessage[] = [];
  private isProcessingQueue = false;
  private processingTimer: NodeJS.Timeout | null = null;

  constructor(
    private state: ExtensionState,
    private workflow: KaiInteractiveWorkflow,
    private modifiedFilesPromises: Array<Promise<void>>,
    private processedTokens: Set<string>,
    private pendingInteractions: Map<string, (response: any) => void>,
    private maxTaskManagerIterations: number,
  ) {
    // Start background processor that runs continuously
    this.startBackgroundProcessor();
  }

  /**
   * Adds a message to the queue
   */
  enqueueMessage(message: KaiWorkflowMessage): void {
    this.messageQueue.push(message);
    console.log(
      `Message enqueued: ${message.type} (${message.id}), queue length: ${this.messageQueue.length}`,
    );

    // If queue is getting large, log a warning
    if (this.messageQueue.length > 50) {
      console.warn(
        `Queue is growing large: ${this.messageQueue.length} messages. Consider implementing backpressure.`,
      );
    }
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
   * Starts a background processor that continuously tries to process messages
   * This handles the continuous stream of messages from the server
   */
  private startBackgroundProcessor(): void {
    const processInterval = 100; // Check every 100ms

    this.processingTimer = setInterval(() => {
      // Only process if we're not already processing and not waiting for user
      if (
        !this.isProcessingQueue &&
        !this.state.isWaitingForUserInteraction &&
        this.messageQueue.length > 0
      ) {
        this.processQueuedMessages().catch((error) => {
          console.error("Error in background queue processing:", error);
        });
      }
    }, processInterval);

    console.log("Background queue processor started");
  }

  /**
   * Stops the background processor (for cleanup)
   */
  stopBackgroundProcessor(): void {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = null;
      console.log("Background queue processor stopped");
    }
  }

  /**
   * Processes queued messages one at a time atomically
   * Stops immediately when a blocking message triggers user interaction
   */
  async processQueuedMessages(): Promise<void> {
    // Prevent concurrent queue processing
    if (this.isProcessingQueue) {
      return;
    }

    if (this.messageQueue.length === 0) {
      return;
    }

    // Don't process if waiting for user interaction
    if (this.state.isWaitingForUserInteraction) {
      console.log(
        `Deferring queue processing - user interaction in progress (${this.messageQueue.length} messages queued)`,
      );
      return;
    }

    this.isProcessingQueue = true;
    console.log(`Starting queue processing with ${this.messageQueue.length} messages`);

    try {
      // Process messages one at a time from the front of the queue
      while (this.messageQueue.length > 0 && !this.state.isWaitingForUserInteraction) {
        // Take the first message from queue
        const msg = this.messageQueue.shift()!;

        try {
          // Check for duplicates before processing
          if (!shouldProcessMessage(msg, this.state.lastMessageId, this.processedTokens)) {
            console.log(`Skipping duplicate message: ${msg.type} (${msg.id})`);
            continue;
          }

          console.log(`Processing queued message ${msg.id} of type ${msg.type}`);

          // Call the core processing logic directly
          const { processMessageByType } = await import("./processMessage");
          await processMessageByType(
            msg,
            this.state,
            this.workflow,
            this.modifiedFilesPromises,
            this.processedTokens,
            this.pendingInteractions,
            this.maxTaskManagerIterations,
            this,
          );

          // If this message triggered user interaction, stop processing
          if (this.state.isWaitingForUserInteraction) {
            console.log(`Queue processing paused - message ${msg.id} triggered user interaction`);
            console.log(`Remaining messages in queue: ${this.messageQueue.length}`);
            break;
          }
        } catch (error) {
          console.error(`Error processing queued message ${msg.id}:`, error);
          // Continue processing other messages even if one fails
        }
      }

      if (this.messageQueue.length > 0) {
        console.log(`Queue processing stopped. Remaining messages: ${this.messageQueue.length}`);
      } else {
        console.log(`Queue processing completed. All messages processed.`);
      }
    } catch (error) {
      console.error("Error in queue processing:", error);

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
    console.log("Queue cleared");
  }

  /**
   * Cleanup method
   */
  dispose(): void {
    this.stopBackgroundProcessor();
    this.clearQueue();
  }
}

/**
 * Handle completion of user interactions and resume queued message processing
 * This should be called whenever isWaitingForUserInteraction transitions from true to false
 */
export async function handleUserInteractionComplete(
  state: ExtensionState,
  queueManager: MessageQueueManager,
): Promise<void> {
  console.log("User interaction completed - resetting flag and processing queue");

  // Reset the waiting flag
  state.isWaitingForUserInteraction = false;

  // The background processor will automatically resume processing
  // But we can trigger immediate processing if queue has messages
  if (queueManager.getQueueLength() > 0) {
    console.log(`Resuming ${queueManager.getQueueLength()} queued messages after user interaction`);
    // Don't await - let background processor handle it
    queueManager.processQueuedMessages().catch((error) => {
      console.error("Error resuming queue processing:", error);
    });
  } else {
    console.log(`No queued messages to resume`);
  }
}
