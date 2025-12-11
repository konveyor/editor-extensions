import * as vscode from "vscode";
import { ExtensionState } from "./extensionState";
import {
  EnhancedIncident,
  Scope,
  ChatMessageType,
  getProgrammingLanguageFromUri,
} from "@editor-extensions/shared";
import {
  type KaiWorkflowMessage,
  type KaiInteractiveWorkflowInput,
} from "@editor-extensions/agentic";
import { getConfigAgentMode } from "./utilities/configuration";
import { executeExtensionCommand, executeDeferredWorkflowDisposal } from "./commands";
import { processMessage } from "./utilities/ModifiedFiles/processMessage";
import { MessageQueueManager } from "./utilities/ModifiedFiles/queueManager";
import { v4 as uuidv4 } from "uuid";
import type { Logger } from "winston";

/**
 * Manages the lifecycle of a solution workflow session
 *
 * Note: With batch review architecture:
 * - pendingInteractions is only for UserInteraction messages (yesNo, choice, tasks)
 * - ModifiedFile messages no longer create pending interactions
 * - ModifiedFile messages accumulate in state.pendingBatchReview for batch review
 */
export class SolutionWorkflowOrchestrator {
  private pendingInteractions = new Map<string, (response: any) => void>(); // Only UserInteraction messages
  private workflow: any;
  private queueManager?: MessageQueueManager;
  private processedTokens = new Set<string>();
  private modifiedFilesPromises: Array<Promise<void>> = []; // Still used for file processing
  private agentMode: boolean;
  private workflowRunCompleted = false; // Track if workflow.run() has finished

  constructor(
    private state: ExtensionState,
    private logger: Logger,
    private incidents: EnhancedIncident[],
  ) {
    this.agentMode = getConfigAgentMode();
  }

  /**
   * Validate preconditions before starting workflow
   */
  private validatePreconditions(): { valid: boolean; error?: string } {
    if (this.state.data.isFetchingSolution) {
      return { valid: false, error: "Solution already being fetched" };
    }

    if (this.state.data.configErrors.some((e) => e.type === "genai-disabled")) {
      return { valid: false, error: "GenAI functionality is disabled." };
    }

    if (!this.state.modelProvider) {
      return {
        valid: false,
        error: "Model provider is not configured. Please check your provider settings.",
      };
    }

    const profileName = this.incidents[0]?.activeProfileName;
    if (!profileName) {
      return { valid: false, error: "No profile name found in incidents" };
    }

    return { valid: true };
  }

  /**
   * Initialize the workflow session
   */
  private async initializeWorkflow(): Promise<void> {
    this.logger.info("Initializing workflow", {
      incidentsCount: this.incidents.length,
      agentMode: this.agentMode,
      solutionServerClient: this.state.hubConnectionManager.getSolutionServerClient(),
    });

    // Initialize workflow manager
    await this.state.workflowManager.init({
      modelProvider: this.state.modelProvider!,
      workspaceDir: this.state.data.workspaceRoot,
      solutionServerClient: this.state.hubConnectionManager.getSolutionServerClient(),
    });

    this.workflow = this.state.workflowManager.getWorkflow();
    this.logger.debug("Workflow initialized");
  }

  /**
   * Clean up stale state from previous workflow runs
   */
  private cleanupStaleState(): void {
    this.logger.debug("Cleaning up stale state from previous runs");

    // Clean up existing queue manager
    if (this.state.currentQueueManager) {
      this.state.currentQueueManager.dispose();
      this.state.currentQueueManager = undefined;
    }

    // Clean up pending interactions
    if (this.state.pendingInteractionsMap && this.state.pendingInteractionsMap.size > 0) {
      this.state.pendingInteractionsMap.clear();
      this.state.pendingInteractionsMap = undefined;
    }

    // Clean up resolver
    if (this.state.resolvePendingInteraction) {
      this.state.resolvePendingInteraction = undefined;
    }

    // Clear modified files
    this.state.modifiedFiles.clear();

    // Reset state flags to prevent stale UI overlays
    this.state.mutateSolutionWorkflow((draft) => {
      draft.isWaitingForUserInteraction = false;
      draft.isProcessingQueuedMessages = false;
    });
    this.state.mutateChatMessages((draft) => {
      draft.chatMessages = [];
    });
  }

  /**
   * Set up the queue manager for handling workflow messages
   * Note: With batch review, pendingInteractions only tracks UserInteraction messages
   */
  private setupQueueManager(): void {
    this.queueManager = new MessageQueueManager(
      this.state,
      this.workflow,
      this.modifiedFilesPromises,
      this.processedTokens,
      this.pendingInteractions, // Only for UserInteraction messages
    );

    // Store references in state for external access
    this.state.currentQueueManager = this.queueManager;
    this.state.pendingInteractionsMap = this.pendingInteractions;

    // Set up the resolver function (only resolves UserInteraction messages)
    this.state.resolvePendingInteraction = this.createInteractionResolver();

    // Register onDrain handler to trigger cleanup when queue empties
    this.queueManager.onDrain(() => {
      this.handleQueueDrained();
    });
  }

  /**
   * Handle queue drain event - check if workflow should complete
   * Called automatically when the queue becomes empty
   */
  private handleQueueDrained(): void {
    this.logger.info("Queue drained, checking workflow completion", {
      workflowRunCompleted: this.workflowRunCompleted,
      pendingInteractionsSize: this.pendingInteractions.size,
      isWaitingForUserInteraction: this.state.data.isWaitingForUserInteraction,
      isFetchingSolution: this.state.data.isFetchingSolution,
      queueLength: this.queueManager?.getQueueLength() ?? 0,
    });

    // Workflow is complete when:
    // 1. workflow.run() has finished
    // 2. All UserInteraction messages are resolved
    // 3. Queue is empty
    const workflowComplete =
      this.workflowRunCompleted &&
      this.pendingInteractions.size === 0 &&
      !this.state.data.isWaitingForUserInteraction &&
      this.queueManager!.getQueueLength() === 0;

    if (workflowComplete && this.state.data.isFetchingSolution) {
      this.logger.info("Workflow complete - cleaning up workflow resources");
      this.workflowCleanup();
    } else if (workflowComplete) {
      this.logger.warn(
        "Workflow complete but isFetchingSolution is false - may have already cleaned up",
      );
    }
  }

  /**
   * Create the resolver function for pending interactions
   */
  private createInteractionResolver() {
    return (messageId: string, response: any): boolean => {
      const resolver = this.pendingInteractions.get(messageId);

      if (!resolver) {
        this.logger.error("Resolver not found for messageId", {
          messageId,
          availableResolvers: Array.from(this.pendingInteractions.keys()),
        });
        return false;
      }

      try {
        this.pendingInteractions.delete(messageId);
        resolver(response);

        const queueLength = this.state.currentQueueManager?.getQueueLength() ?? 0;
        this.logger.debug("Interaction resolved", {
          messageId,
          remainingInteractions: this.pendingInteractions.size,
          queueLength,
          isWaitingForUserInteraction: this.state.data.isWaitingForUserInteraction,
        });

        // Let the queue drain handler check for workflow completion
        if (this.pendingInteractions.size === 0 && queueLength === 0 && this.workflowRunCompleted) {
          // Force queue drain check
          this.handleQueueDrained();
        }

        return true;
      } catch (error) {
        this.logger.error("Error executing resolver", { messageId, error });
        return false;
      }
    };
  }

  /**
   * Set up event listeners for workflow messages
   */
  private setupEventListeners(): void {
    this.workflow.removeAllListeners();

    // Handle workflow messages
    this.workflow.on("workflowMessage", async (msg: KaiWorkflowMessage) => {
      await processMessage(msg, this.state, this.queueManager!);
    });

    // Handle workflow errors
    this.workflow.on("error", (error: any) => {
      this.logger.error("Workflow error:", error);
      this.state.mutateSolutionWorkflow((draft) => {
        draft.isFetchingSolution = false;
        if (draft.solutionState === "started") {
          draft.solutionState = "failedOnSending";
        }
      });
      executeDeferredWorkflowDisposal(this.state, this.logger);
    });
  }

  /**
   * Execute the workflow
   */
  private async executeWorkflow(): Promise<void> {
    const profileName = this.incidents[0]!.activeProfileName!;

    const programmingLanguage =
      this.incidents.length > 0 ? getProgrammingLanguageFromUri(this.incidents[0].uri) : "Java";

    const input: KaiInteractiveWorkflowInput = {
      incidents: this.incidents,
      migrationHint: profileName,
      programmingLanguage,
      enableAgentMode: this.agentMode,
    };

    await this.workflow.run(input);

    this.logger.info("Workflow.run() completed", {
      agentMode: this.agentMode,
      pendingInteractionsCount: this.pendingInteractions.size,
      queueLength: this.queueManager!.getQueueLength(),
      isWaitingForUserInteraction: this.state.data.isWaitingForUserInteraction,
    });

    // Wait for processing based on mode
    await this.waitForProcessing();
  }

  /**
   * Wait for message processing to complete based on agent mode
   */
  private async waitForProcessing(): Promise<void> {
    if (this.agentMode) {
      // In agent mode, workflow.run() has completed but messages might still be in queue
      // Give a brief delay to ensure all messages are processed
      await new Promise((resolve) => setTimeout(resolve, 100));

      this.logger.info("After delay in agent mode", {
        pendingInteractionsCount: this.pendingInteractions.size,
        queueLength: this.queueManager!.getQueueLength(),
        isWaitingForUserInteraction: this.state.data.isWaitingForUserInteraction,
      });
    } else {
      // In non-agent mode, give a delay to ensure messages are queued
      // The queue manager will process them and wait for user interactions
      await new Promise((resolve) => setTimeout(resolve, 500));

      this.logger.info("After delay in non-agent mode", {
        pendingInteractionsCount: this.pendingInteractions.size,
        queueLength: this.queueManager!.getQueueLength(),
        isWaitingForUserInteraction: this.state.data.isWaitingForUserInteraction,
        chatMessagesCount: this.state.data.chatMessages.length,
      });
    }
  }

  /**
   * Handle workflow execution errors
   */
  private handleWorkflowError(err: unknown): void {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const isStringLengthError = errorMessage.includes("Invalid string length");

    this.logger.error("Error in running the agent", { errorMessage });

    if (!isStringLengthError && err instanceof Error) {
      this.logger.info("Error trace", { stack: err.stack });
    } else if (isStringLengthError) {
      this.logger.error(
        "Invalid string length error - likely due to logging large/circular objects in workflow",
      );
    }

    // Update state
    this.state.mutateSolutionWorkflow((draft) => {
      draft.isFetchingSolution = false;
      if (draft.solutionState === "started") {
        draft.solutionState = "failedOnSending";
      }
      if (isStringLengthError) {
        draft.isWaitingForUserInteraction = false;
      }
    });

    // Add error message to chat
    this.state.mutateChatMessages((draft) => {
      draft.chatMessages.push({
        messageToken: `error-${Date.now()}`,
        kind: ChatMessageType.String,
        value: {
          message: isStringLengthError
            ? "Error: Workflow failed due to internal logging issue. This typically happens with large analysis runs. Please try with fewer incidents at once."
            : `Error: ${errorMessage}`,
        },
        timestamp: new Date().toISOString(),
      });
    });

    // Clean up queue manager if string length error
    if (isStringLengthError && this.queueManager) {
      this.logger.info("Disposing queue manager due to workflow error");
      this.queueManager.dispose();
    }

    executeDeferredWorkflowDisposal(this.state, this.logger);
  }

  /**
   * Cleanup workflow resources but keep batch review intact
   * Called when the workflow itself is complete (all UserInteractions resolved)
   */
  private workflowCleanup(): void {
    this.logger.info("Performing workflow cleanup - batch review will remain active");

    this.state.mutateSolutionWorkflow((draft) => {
      draft.isFetchingSolution = false;
      draft.solutionState = "received";
      draft.isProcessingQueuedMessages = false;
      // Keep pendingBatchReview intact - it's handled separately
    });

    this.state.mutateAnalysisState((draft) => {
      draft.isAnalyzing = false;
      draft.isAnalysisScheduled = false;
    });

    // Dispose queue manager
    if (this.state.currentQueueManager) {
      this.state.currentQueueManager.dispose();
      this.state.currentQueueManager = undefined;
    }

    // Clear pending interactions
    this.pendingInteractions.clear();
    this.state.pendingInteractionsMap = undefined;
    this.state.resolvePendingInteraction = undefined;

    // Reset cache
    this.state.kaiFsCache.reset();

    // Clean up workflow resources
    if (this.workflow) {
      this.workflow.removeAllListeners();
    }

    // Dispose of workflow manager
    if (this.state.workflowManager && this.state.workflowManager.dispose) {
      this.state.workflowManager.dispose();
    }

    executeDeferredWorkflowDisposal(this.state, this.logger);
  }

  /**
   * Final cleanup - only called when batch review is complete and pendingBatchReview is empty
   * This is separate from workflowCleanup() to allow batch review to function after workflow completes
   */
  private finalCleanup(): void {
    this.logger.info("Performing final cleanup");

    this.state.mutateSolutionWorkflow((draft) => {
      draft.isFetchingSolution = false;
      draft.solutionState = "received";
      draft.isProcessingQueuedMessages = false;
    });

    this.state.mutateAnalysisState((draft) => {
      draft.isAnalyzing = false;
      draft.isAnalysisScheduled = false;
    });

    // Dispose queue manager
    if (this.state.currentQueueManager) {
      this.state.currentQueueManager.dispose();
      this.state.currentQueueManager = undefined;
    }

    // Clear pending interactions
    this.pendingInteractions.clear();
    this.state.pendingInteractionsMap = undefined;
    this.state.resolvePendingInteraction = undefined;

    // Reset cache
    this.state.kaiFsCache.reset();

    // Clean up workflow resources
    if (this.workflow) {
      this.workflow.removeAllListeners();
    }

    // Dispose of workflow manager
    if (this.state.workflowManager && this.state.workflowManager.dispose) {
      this.state.workflowManager.dispose();
    }

    executeDeferredWorkflowDisposal(this.state, this.logger);
  }

  /**
   * Clean up resources after workflow execution
   */
  private cleanupAfterExecution(): void {
    this.logger.info("Workflow execution finished - cleaning up");

    // Reset analysis flags
    this.state.mutateAnalysisState((draft) => {
      draft.isAnalyzing = false;
      draft.isAnalysisScheduled = false;
    });

    // The workflow is done - clean it up
    this.workflowCleanup();
  }

  /**
   * Initialize state for a new workflow session
   */
  private initializeState(): void {
    const scope: Scope = { incidents: this.incidents };
    const clientId = uuidv4();

    this.state.hubConnectionManager.getSolutionServerClient()?.setClientId(clientId);
    this.logger.debug("Client ID set", { clientId });

    this.logger.info("Initializing workflow state", {
      incidentCount: this.incidents.length,
      incidentUris: this.incidents.map((i) => i.uri),
    });

    this.state.mutateSolutionWorkflow((draft) => {
      draft.isFetchingSolution = true;
      draft.solutionState = "started";
      draft.solutionScope = scope;
      // Reset loading states from previous runs
      draft.isProcessingQueuedMessages = false;
      draft.isWaitingForUserInteraction = false;
      draft.pendingBatchReview = [];
    });

    this.state.mutateChatMessages((draft) => {
      draft.chatMessages = [];
    });

    this.state.mutateDecorators((draft) => {
      draft.activeDecorators = {};
    });
  }

  /**
   * Main entry point to run the solution workflow
   */
  async run(): Promise<void> {
    // Validate preconditions
    const validation = this.validatePreconditions();
    if (!validation.valid) {
      this.logger.info("Validation failed", { error: validation.error });
      if (validation.error?.includes("already being fetched")) {
        vscode.window.showWarningMessage(validation.error);
      } else {
        vscode.window.showErrorMessage(validation.error!);
      }
      return;
    }

    this.logger.info("Starting solution workflow", {
      incidentsCount: this.incidents.length,
      agentMode: this.agentMode,
    });

    // Show resolution panel
    await executeExtensionCommand("showResolutionPanel");

    // Initialize state
    this.initializeState();

    try {
      // Initialize workflow
      await this.initializeWorkflow();

      // Clean up stale state
      this.cleanupStaleState();

      // Set up queue manager
      this.setupQueueManager();

      // Set up event listeners
      this.setupEventListeners();

      try {
        // Execute workflow
        await this.executeWorkflow();
      } catch (err) {
        this.handleWorkflowError(err);
      } finally {
        // Mark that workflow.run() has completed
        // This prevents premature cleanup while workflow is between phases
        this.workflowRunCompleted = true;

        // cleanupAfterExecution() handles mode-specific cleanup:
        // - Agent mode: cleans up if queue is drained
        // - Non-agent mode: defers cleanup to interaction resolver
        this.cleanupAfterExecution();
      }

      this.logger.info("Workflow execution complete", {
        agentMode: this.agentMode,
        pendingInteractionsCount: this.pendingInteractions.size,
        queueLength: this.queueManager?.getQueueLength() ?? 0,
        isWaitingForUserInteraction: this.state.data.isWaitingForUserInteraction,
      });
    } catch (error: any) {
      this.logger.error("Error in getSolution", { error });

      this.state.mutateSolutionWorkflow((draft) => {
        draft.solutionState = "failedOnSending";
        draft.isFetchingSolution = false;
      });

      this.state.mutateChatMessages((draft) => {
        draft.chatMessages.push({
          messageToken: `m${Date.now()}`,
          kind: ChatMessageType.String,
          value: { message: `Error: ${error instanceof Error ? error.message : String(error)}` },
          timestamp: new Date().toISOString(),
        });
      });

      executeDeferredWorkflowDisposal(this.state, this.logger);

      vscode.window.showErrorMessage(
        `Failed to generate solution: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
