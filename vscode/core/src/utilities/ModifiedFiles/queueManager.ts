import { KaiWorkflowMessage, KaiInteractiveWorkflow } from "@editor-extensions/agentic";
import { ExtensionState } from "src/extensionState";
import { ChatMessageType } from "@editor-extensions/shared";
import { Logger } from "winston";

/**
 * Centralized queue manager for handling message queuing and processing
 * Uses continuous background processing with flow control for streaming messages
 */
export class MessageQueueManager {
  private messageQueue: KaiWorkflowMessage[] = [];
  private isProcessingQueue = false;
  private processingTimer: NodeJS.Timeout | null = null;
  private logger: Logger;
  private onDrainCallback?: () => void;

  constructor(
    private state: ExtensionState,
    private workflow: KaiInteractiveWorkflow,
    private modifiedFilesPromises: Array<Promise<void>>,
    private processedTokens: Set<string>,
    private pendingInteractions: Map<string, (response: any) => void>,
  ) {
    // Start background processor that runs continuously
    this.startBackgroundProcessor();
    this.logger = state.logger.child({
      component: "MessageQueueManager",
    });
  }

  /**
   * Register a callback to be invoked when the queue drains (becomes empty)
   */
  onDrain(callback: () => void): void {
    this.onDrainCallback = callback;
  }

  /**
   * Adds a message to the queue
   */
  enqueueMessage(message: KaiWorkflowMessage): void {
    this.messageQueue.push(message);
    this.logger.debug(
      `Message enqueued: ${message.type}, id: ${message.id}, queue length: ${this.messageQueue.length}`,
    );
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
        !this.state.data.isWaitingForUserInteraction &&
        this.messageQueue.length > 0
      ) {
        this.processQueuedMessages().catch((error) => {
          this.logger.error("Error in background queue processing:", error);
        });
      }
    }, processInterval);
  }

  /**
   * Stops the background processor (for cleanup)
   */
  stopBackgroundProcessor(): void {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = null;
    }
  }

  /**
   * Processes queued messages one at a time atomically
   * Stops immediately when a blocking message triggers user interaction
   */
  async processQueuedMessages(): Promise<void> {
    // Prevent concurrent queue processing
    if (this.isProcessingQueue) {
      this.logger.debug("Already processing queue, skipping");
      return;
    }

    if (this.messageQueue.length === 0) {
      this.logger.debug("Queue is empty, nothing to process");
      return;
    }

    // Don't process if waiting for user interaction
    if (this.state.data.isWaitingForUserInteraction) {
      this.logger.debug("Waiting for user interaction, skipping queue processing");
      return;
    }

    this.logger.info(`Starting queue processing, ${this.messageQueue.length} messages in queue`);
    this.isProcessingQueue = true;

    try {
      // Process messages one at a time from the front of the queue
      while (this.messageQueue.length > 0 && !this.state.data.isWaitingForUserInteraction) {
        // Take the first message from queue
        const msg = this.messageQueue.shift()!;
        this.logger.info(
          `Processing message: ${msg.type}, id: ${msg.id}, remaining in queue: ${this.messageQueue.length}`,
        );

        try {
          // Call the core processing logic directly
          const { processMessageByType } = await import("./processMessage");
          await processMessageByType(
            msg,
            this.state,
            this.workflow,
            this.modifiedFilesPromises,
            this.processedTokens,
            this.pendingInteractions,
            this,
          );

          // If this message triggered user interaction, stop processing
          if (this.state.data.isWaitingForUserInteraction) {
            this.logger.info(
              `Message ${msg.id} triggered user interaction, stopping queue processing`,
            );
            break;
          }
        } catch (error) {
          this.logger.error(`Error processing queued message ${msg.id}:`, error);
          // Continue processing other messages even if one fails
        }
      }

      this.logger.info(`Queue processing complete, ${this.messageQueue.length} messages remaining`);
    } catch (error) {
      this.logger.error("Error in queue processing:", error);

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

      // If queue is now empty and we have a drain callback, invoke it
      // This allows the orchestrator to check if cleanup should happen
      if (this.messageQueue.length === 0 && this.onDrainCallback) {
        this.logger.debug("Queue drained, invoking onDrain callback");
        try {
          this.onDrainCallback();
        } catch (error) {
          this.logger.error("Error in onDrain callback:", error);
        }
      }
    }
  }

  /**
   * Clears the queue (useful for cleanup)
   */
  clearQueue(): void {
    this.messageQueue.length = 0;
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
  // CRITICAL: Always reset the waiting flag to allow queue processing to continue
  // Must set to false to unblock the queue processor
  state.mutateData((draft) => {
    draft.isWaitingForUserInteraction = false;
  });

  // The background processor will automatically resume processing
  // But we can trigger immediate processing if queue has messages
  if (queueManager.getQueueLength() > 0) {
    // Don't await - let background processor handle it
    queueManager.processQueuedMessages().catch((error) => {
      state.logger
        .child({ component: "MessageQueueManager.handleUserInteractionComplete" })
        .error("Error resuming queue processing:", error);
    });
  }
}
