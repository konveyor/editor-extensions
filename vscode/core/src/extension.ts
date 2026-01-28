import * as vscode from "vscode";
import { EventEmitter } from "events";
import { KonveyorGUIWebviewViewProvider } from "./KonveyorGUIWebviewViewProvider";
import { registerAllCommands as registerAllCommands } from "./commands";
import { ExtensionState } from "./extensionState";
import {
  ConfigError,
  createConfigError,
  ExtensionData,
  MessageTypes,
} from "@editor-extensions/shared";
import { ViolationCodeActionProvider } from "./ViolationCodeActionProvider";
import { AnalyzerClient } from "./client/analyzerClient";
import {
  BUILD_INFO,
  EXTENSION_DISPLAY_NAME,
  EXTENSION_ID,
  EXTENSION_NAME,
  EXTENSION_VERSION,
} from "./utilities/constants";
import {
  KaiInteractiveWorkflow,
  InMemoryCacheWithRevisions,
  FileBasedResponseCache,
  type KaiModelProvider,
} from "@editor-extensions/agentic";
import { HubConnectionManager } from "./hub";
import { Immutable, produce } from "immer";
import { registerAnalysisTrigger } from "./analysis";
import { IssuesModel, registerIssueView } from "./issueView";
import { ExtensionPaths, ensurePaths, paths, ensureKaiAnalyzerBinary } from "./paths";
import { copySampleProviderSettings } from "./utilities/fileUtils";
import {
  getExcludedDiagnosticSources,
  getConfigAgentMode,
  getCacheDir,
  getTraceDir,
  getTraceEnabled,
  getConfigKaiDemoMode,
  getConfigLogLevel,
  getConfigGenAIEnabled,
  getConfigAutoAcceptOnSave,
  updateConfigErrors,
} from "./utilities";
import {
  initializeHubConfig,
  getDefaultHubConfig,
  isHubForced,
} from "./utilities/hubConfigStorage";
import { getAllProfiles } from "./utilities/profiles/profileService";
import { DiagnosticTaskManager } from "./taskManager/taskManager";
// Removed registerSuggestionCommands import since we're using merge editor now
// Removed InlineSuggestionCodeActionProvider import since we're using merge editor now
import { ParsedModelConfig } from "./modelProvider/types";
import { getModelProviderFromConfig, parseModelConfig } from "./modelProvider";
import { BaseModelProvider, type ModelProviderOptions } from "./modelProvider/modelProvider";
import { getCacheForModelProvider } from "./modelProvider/utils";
import { ChatOpenAI } from "@langchain/openai";
import { BaseMessage } from "@langchain/core/messages";
import winston from "winston";
import * as pathlib from "path";
import { OutputChannelTransport } from "winston-transport-vscode";
// Removed - replaced with vertical diff system
// import { DiffDecorationManager } from "./decorations";
import { VerticalDiffManager } from "./diff/vertical/manager";
import { StaticDiffAdapter } from "./diff/staticDiffAdapter";
import { FileEditor } from "./utilities/ideUtils";
import { ProviderRegistry, HealthCheckRegistry, createCoreApi } from "./api";
import { KonveyorCoreApi } from "@editor-extensions/shared";

class VsCodeExtension {
  public state: ExtensionState;
  private data: Immutable<ExtensionData>;
  private _onDidChange = new vscode.EventEmitter<Immutable<ExtensionData>>();
  readonly onDidChangeData = this._onDidChange.event;
  private listeners: vscode.Disposable[] = [];
  private diffStatusBarItem: vscode.StatusBarItem;

  constructor(
    public readonly paths: ExtensionPaths,
    public readonly context: vscode.ExtensionContext,
    logger: winston.Logger,
    private readonly providerRegistry: ProviderRegistry,
    private readonly healthCheckRegistry: HealthCheckRegistry,
  ) {
    this.diffStatusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    const isWebEnvironment = vscode.env.uiKind === vscode.UIKind.Web;

    this.data = produce(
      {
        ruleSets: [],
        enhancedIncidents: [],
        isAnalyzing: false,
        analysisProgress: 0,
        analysisProgressMessage: "",
        isFetchingSolution: false,
        isStartingServer: false,
        isInitializingServer: false,
        isAnalysisScheduled: false,
        isContinueInstalled: false,
        serverState: "initial",
        solutionScope: undefined,
        workspaceRoot: paths.workspaceRepo.toString(true),
        chatMessages: [],
        solutionState: "none",
        solutionServerEnabled: false, // Will be updated after hub config loads
        configErrors: [],
        llmErrors: [],
        activeProfileId: "",
        profiles: [],
        isInTreeMode: false, // Computed when profiles are set
        isAgentMode: getConfigAgentMode(),
        activeDecorators: {},
        solutionServerConnected: false,
        isWaitingForUserInteraction: false,
        hubConfig: getDefaultHubConfig(), // Will be updated after async initialization
        hubForced: false, // Will be updated after checking env vars
        isProcessingQueuedMessages: false,
        profileSyncEnabled: false, // Will be updated after hub config loads
        profileSyncConnected: false,
        isSyncingProfiles: false,
        llmProxyAvailable: false, // Will be updated after hub initialization
        isWebEnvironment, // True when running in web (DevSpaces, vscode.dev)
        analysisConfig: {
          labelSelector: "",
          labelSelectorValid: false,
          providerConfigured: false,
          providerKeyMissing: false,
          customRulesConfigured: false,
        },
      } as ExtensionData,
      () => {},
    );
    const getData = () => this.data;

    // Update chat messages without triggering global state change (sends only chat delta to webview)
    const mutateChatMessages = (
      recipe: (draft: ExtensionData) => void,
    ): Immutable<ExtensionData> => {
      const oldMessages = getData().chatMessages;
      const data = produce(getData(), recipe);

      // Update internal state WITHOUT firing global change event
      this.data = data;

      // Optimize: Only send changed messages to reduce webview overhead
      // If we're streaming (same number of messages), send just the last message
      // Otherwise send the full array (for new messages, deletions, etc.)
      const isStreamingUpdate =
        data.chatMessages.length === oldMessages.length && data.chatMessages.length > 0;

      if (isStreamingUpdate) {
        // Streaming chunk - send only the last message for efficiency
        const lastMessage = data.chatMessages[data.chatMessages.length - 1];
        logger.info(`[Streaming] Sending incremental update`, {
          messageIndex: data.chatMessages.length - 1,
          messageLength: (lastMessage.value as any)?.message?.length || 0,
          messageToken: lastMessage.messageToken,
        });

        // CRITICAL: Create a plain object copy to avoid Immer proxy issues
        // Immer's immutable data might reuse object references internally
        const plainMessage = JSON.parse(JSON.stringify(lastMessage));

        // Broadcast streaming update to all webviews
        broadcastToWebviews((provider) => {
          provider.sendMessageToWebview({
            type: MessageTypes.CHAT_MESSAGE_STREAMING_UPDATE,
            message: plainMessage,
            messageIndex: data.chatMessages.length - 1,
            timestamp: new Date().toISOString(),
          });
        });
      } else {
        // Structure change - send full array
        broadcastToWebviews((provider) => {
          provider.sendMessageToWebview({
            type: MessageTypes.CHAT_MESSAGES_UPDATE,
            chatMessages: data.chatMessages,
            previousLength: oldMessages.length,
            timestamp: new Date().toISOString(),
          });
        });
      }

      return data;
    };

    // Update analysis state and notify all listeners
    const mutateAnalysisState = (
      recipe: (draft: ExtensionData) => void,
    ): Immutable<ExtensionData> => {
      const data = produce(getData(), recipe);
      this.data = data;

      // Send only analysis state to webviews
      broadcastToWebviews((provider) => {
        provider.sendMessageToWebview({
          type: MessageTypes.ANALYSIS_STATE_UPDATE,
          ruleSets: data.ruleSets,
          enhancedIncidents: data.enhancedIncidents,
          isAnalyzing: data.isAnalyzing,
          isAnalysisScheduled: data.isAnalysisScheduled,
          analysisProgress: data.analysisProgress,
          analysisProgressMessage: data.analysisProgressMessage,
          timestamp: new Date().toISOString(),
        });
      });

      // Fire the global change event to notify extension listeners
      this._onDidChange.fire(this.data);

      return data;
    };

    // Update solution workflow state without triggering global state change
    const mutateSolutionWorkflow = (
      recipe: (draft: ExtensionData) => void,
    ): Immutable<ExtensionData> => {
      const data = produce(getData(), recipe);
      this.data = data;

      // Send only solution workflow state to webviews
      broadcastToWebviews((provider) => {
        provider.sendMessageToWebview({
          type: MessageTypes.SOLUTION_WORKFLOW_UPDATE,
          isFetchingSolution: data.isFetchingSolution,
          solutionState: data.solutionState,
          solutionScope: data.solutionScope,
          isWaitingForUserInteraction: data.isWaitingForUserInteraction,
          isProcessingQueuedMessages: data.isProcessingQueuedMessages,
          pendingBatchReview: data.pendingBatchReview || [],
          timestamp: new Date().toISOString(),
        });
      });

      return data;
    };

    // Update server state without triggering global state change
    const mutateServerState = (
      recipe: (draft: ExtensionData) => void,
    ): Immutable<ExtensionData> => {
      const data = produce(getData(), recipe);
      this.data = data;

      // Send only server state to webviews
      broadcastToWebviews((provider) => {
        provider.sendMessageToWebview({
          type: MessageTypes.SERVER_STATE_UPDATE,
          serverState: data.serverState,
          isStartingServer: data.isStartingServer,
          isInitializingServer: data.isInitializingServer,
          solutionServerConnected: data.solutionServerConnected,
          profileSyncConnected: data.profileSyncConnected,
          llmProxyAvailable: data.llmProxyAvailable,
          timestamp: new Date().toISOString(),
        });
      });

      return data;
    };

    // Update profiles without triggering global state change
    const mutateProfiles = (recipe: (draft: ExtensionData) => void): Immutable<ExtensionData> => {
      const data = produce(getData(), recipe);

      // Compute isInTreeMode: true when hub profiles are present
      // This means profiles are managed by Hub, not created in the webview
      const isInTreeMode = data.profiles.some((p) => p.source === "hub");

      // Warn user if they have hub profiles but profile sync is disabled
      // They need to delete the synced profiles to regain control
      if (isInTreeMode && !data.hubConfig?.features?.profileSync?.enabled) {
        this.state?.logger?.warn(
          "Hub-synced profiles detected but profile sync is disabled. " +
            "Delete the .konveyor/profiles directory to manage profiles in the webview.",
        );
      }

      // Update isInTreeMode in state
      this.data = produce(data, (draft) => {
        draft.isInTreeMode = isInTreeMode;
      });

      // Send only profiles to webviews
      broadcastToWebviews((provider) => {
        provider.sendMessageToWebview({
          type: MessageTypes.PROFILES_UPDATE,
          profiles: this.data.profiles,
          activeProfileId: this.data.activeProfileId,
          isInTreeMode: this.data.isInTreeMode,
          timestamp: new Date().toISOString(),
        });
      });

      return this.data;
    };

    // Update config errors without triggering global state change
    const mutateConfigErrors = (
      recipe: (draft: ExtensionData) => void,
    ): Immutable<ExtensionData> => {
      const data = produce(getData(), recipe);
      this.data = data;

      // Send only config errors to webviews
      broadcastToWebviews((provider) => {
        provider.sendMessageToWebview({
          type: MessageTypes.CONFIG_ERRORS_UPDATE,
          configErrors: data.configErrors,
          timestamp: new Date().toISOString(),
        });
      });

      return data;
    };

    // Update decorators without triggering global state change
    const mutateDecorators = (recipe: (draft: ExtensionData) => void): Immutable<ExtensionData> => {
      const data = produce(getData(), recipe);
      this.data = data;

      // Send only decorators to webviews
      broadcastToWebviews((provider) => {
        provider.sendMessageToWebview({
          type: MessageTypes.DECORATORS_UPDATE,
          activeDecorators: data.activeDecorators || {},
          timestamp: new Date().toISOString(),
        });
      });

      return data;
    };

    // Update settings without triggering global state change
    const mutateSettings = (recipe: (draft: ExtensionData) => void): Immutable<ExtensionData> => {
      const data = produce(getData(), recipe);
      this.data = data;

      // Send only settings to webviews
      broadcastToWebviews((provider) => {
        provider.sendMessageToWebview({
          type: MessageTypes.SETTINGS_UPDATE,
          solutionServerEnabled: data.solutionServerEnabled,
          isAgentMode: data.isAgentMode,
          isContinueInstalled: data.isContinueInstalled,
          hubConfig: data.hubConfig,
          hubForced: data.hubForced,
          profileSyncEnabled: data.profileSyncEnabled,
          isSyncingProfiles: data.isSyncingProfiles,
          llmProxyAvailable: data.llmProxyAvailable,
          timestamp: new Date().toISOString(),
        });
      });

      return data;
    };

    // Helper to safely broadcast messages to webview providers
    const broadcastToWebviews = (messageFn: (provider: KonveyorGUIWebviewViewProvider) => void) => {
      const extensionState = (this as VsCodeExtension).state;
      if (extensionState?.webviewProviders) {
        extensionState.webviewProviders.forEach((provider) => {
          messageFn(provider);
        });
      }
    };

    const taskManager = new DiagnosticTaskManager(getExcludedDiagnosticSources());

    this.state = {
      analyzerClient: new AnalyzerClient(
        context,
        mutateServerState,
        mutateAnalysisState,
        getData,
        taskManager,
        logger,
        providerRegistry,
      ),
      hubConnectionManager: new HubConnectionManager(getDefaultHubConfig(), logger),
      webviewProviders: new Map<string, KonveyorGUIWebviewViewProvider>(),
      extensionContext: context,
      diagnosticCollection: vscode.languages.createDiagnosticCollection("konveyor"),
      issueModel: new IssuesModel(),
      kaiFsCache: new InMemoryCacheWithRevisions(true),
      taskManager,
      logger,
      get data() {
        return getData();
      },
      mutateChatMessages,
      mutateAnalysisState,
      mutateSolutionWorkflow,
      mutateServerState,
      mutateProfiles,
      mutateConfigErrors,
      mutateDecorators,
      mutateSettings,
      modifiedFiles: new Map(),
      modifiedFilesEventEmitter: new EventEmitter(),
      lastMessageId: "0",
      currentTaskManagerIterations: 0,
      workflowManager: {
        workflow: undefined,
        isInitialized: false,
        init: async (config) => {
          if (this.state.workflowManager.isInitialized) {
            return;
          }

          try {
            this.state.workflowManager.workflow = new KaiInteractiveWorkflow(this.state.logger);
            // Make sure fsCache and solutionServerClient are passed to the workflow init
            // Get solution server client from hub connection manager (may be undefined if not connected)
            await this.state.workflowManager.workflow.init({
              ...config,
              fsCache: this.state.kaiFsCache,
              solutionServerClient: config.solutionServerClient,
              toolCache: new FileBasedResponseCache(
                getConfigKaiDemoMode(), // cache enabled only when demo mode is on
                (args) =>
                  typeof args === "string" ? args : JSON.stringify(args, Object.keys(args).sort()),
                (args) => (typeof args === "string" ? args : JSON.parse(args)),
                getCacheDir(this.state.data.workspaceRoot),
                this.state.logger,
              ),
            });
            this.state.workflowManager.isInitialized = true;
          } catch (error) {
            console.error("Failed to initialize workflow:", error);
            // Reset state on initialization failure to avoid inconsistent state
            this.state.workflowManager.workflow = undefined;
            this.state.workflowManager.isInitialized = false;
            throw error; // Re-throw to let caller handle the error
          }
        },
        getWorkflow: () => {
          if (!this.state.workflowManager.workflow) {
            throw new Error("Workflow not initialized");
          }
          return this.state.workflowManager.workflow;
        },
        dispose: () => {
          try {
            // Clean up workflow resources if workflow exists
            if (this.state.workflowManager.workflow) {
              // Remove all event listeners to prevent memory leaks
              this.state.workflowManager.workflow.removeAllListeners();

              // Clear any pending user interactions
              const workflow = this.state.workflowManager.workflow as any;
              if (workflow.userInteractionPromises) {
                workflow.userInteractionPromises.clear();
              }
            }
          } catch (error) {
            console.error("Error during workflow cleanup:", error);
          } finally {
            // Always reset state regardless of cleanup success/failure
            this.state.workflowManager.workflow = undefined;
            this.state.workflowManager.isInitialized = false;
          }
        },
      },
      modelProvider: undefined,
      verticalDiffManager: undefined,
      staticDiffAdapter: undefined,
    };
  }

  public async initialize(): Promise<void> {
    try {
      // Initialize vertical diff system
      this.initializeVerticalDiff();

      // Initialize hub config from secret storage (with migration)
      const hubConfig = await initializeHubConfig(this.context);
      this.state.mutateSettings((draft) => {
        draft.hubConfig = hubConfig;
        draft.hubForced = isHubForced();
        draft.solutionServerEnabled =
          hubConfig.enabled && hubConfig.features.solutionServer.enabled;
        draft.profileSyncEnabled = hubConfig.enabled && hubConfig.features.profileSync.enabled;
        draft.solutionServerConnected = false;
        draft.profileSyncConnected = false;
        draft.isSyncingProfiles = false;
        draft.llmProxyAvailable = false;
      });

      const allProfiles = await getAllProfiles(this.context);
      const storedActiveId = this.context.workspaceState.get<string>("activeProfileId");
      const matchingProfile = allProfiles.find((p) => p.id === storedActiveId);
      const activeProfileId =
        matchingProfile?.id ?? (allProfiles.length > 0 ? allProfiles[0].id : null);

      // Broadcast profiles to webview using granular update
      this.state.mutateProfiles((draft) => {
        draft.profiles = allProfiles;
        draft.activeProfileId = activeProfileId;
      });

      // Update config errors
      this.state.mutateConfigErrors((draft) => {
        this.updateConfigurationErrors(draft);
      });

      // Watch for changes to .konveyor/profiles directory
      this.setupProfileWatcher();

      this.setupModelProvider(paths().settingsYaml)
        .then((configError) => {
          if (configError) {
            this.state.mutateConfigErrors((draft) => {
              draft.configErrors.push(configError);
            });
          }
        })
        .catch((error) => {
          this.state.logger.error("Error setting up model provider:", error);
          if (error) {
            const configError = createConfigError.providerConnnectionFailed();
            configError.error = error instanceof Error ? error.message : String(error);
            this.state.mutateConfigErrors((draft) => {
              draft.configErrors.push(configError);
            });
          }
        });

      this.registerWebviewProvider();
      // Diff view removed - using unified decorator flow instead
      this.listeners.push(this.onDidChangeData(registerIssueView(this.state)));

      await vscode.commands.executeCommand("setContext", `${EXTENSION_NAME}.hasIssues`, false);

      this.registerCoreHealthChecks();
      this.registerCommands();
      this.registerLanguageProviders();

      this.context.subscriptions.push(this.diffStatusBarItem);
      this.checkContinueInstalled();

      // Set up workflow disposal callback for when Hub clients reconnect
      // This handles both solution server changes and LLM proxy availability
      this.state.hubConnectionManager.setWorkflowDisposalCallback(() => {
        this.state.logger.info("Hub clients reconnected, updating workflow and model provider");

        // Update model provider if LLM proxy is available
        const llmProxyConfig = this.state.hubConnectionManager.getLLMProxyConfig();
        if (llmProxyConfig?.available) {
          this.createHubProxyModelProvider(llmProxyConfig)
            .then((provider) => {
              this.state.modelProvider = provider;
              this.state.logger.info("Model provider updated with Hub LLM proxy");

              // Clear GenAI/provider-related config errors
              this.state.mutateConfigErrors((draft) => {
                draft.configErrors = draft.configErrors.filter(
                  (e) =>
                    e.type !== "provider-not-configured" &&
                    e.type !== "provider-connection-failed" &&
                    e.type !== "genai-disabled",
                );
              });
            })
            .catch((error) => {
              this.state.logger.error("Failed to update model provider", error);
            });
        }

        // Dispose workflow if needed (solution server or model provider changed)
        const isWorkflowRunning = this.state.data.isFetchingSolution;
        if (isWorkflowRunning) {
          this.state.logger.warn(
            "Hub clients changed but workflow is running - will dispose after completion",
          );
          this.state.workflowDisposalPending = true;
        } else if (this.state.workflowManager.isInitialized) {
          this.state.logger.info("Disposing workflow to use new Hub clients");
          this.state.workflowManager.dispose();
          this.state.workflowDisposalPending = false;
        }
      });

      // Initialize hub connection manager with loaded config
      // This handles connecting to the solution server if enabled
      let hubInitError: Error | undefined;
      await this.state.hubConnectionManager.initialize(hubConfig).catch((error) => {
        this.state.logger.error("Error initializing Hub connection", error);
        hubInitError = error;
        this.state.mutateServerState((draft) => {
          draft.solutionServerConnected = false;
          draft.profileSyncConnected = false;
        });
      });

      // Update connection state based on initialization result
      this.state.mutateServerState((draft) => {
        draft.solutionServerConnected = this.state.hubConnectionManager.isSolutionServerConnected();
        draft.profileSyncConnected = this.state.hubConnectionManager.isProfileSyncConnected();

        // Update LLM proxy state
        const llmProxyConfig = this.state.hubConnectionManager.getLLMProxyConfig();
        draft.llmProxyAvailable = llmProxyConfig?.available || false;
      });

      // Show warning if Hub initialization failed
      if (hubInitError && hubConfig.enabled) {
        const errorMsg = hubInitError.message || String(hubInitError);
        if (errorMsg.includes("404")) {
          vscode.window.showWarningMessage(
            `Hub connection failed: Authentication endpoint not found. ` +
              `Check that the Hub URL is correct.`,
          );
        } else if (errorMsg.includes("401") || errorMsg.includes("403")) {
          vscode.window.showWarningMessage(
            `Hub connection failed: Authentication failed. Check your username and password.`,
          );
        } else {
          vscode.window.showWarningMessage(`Hub connection failed: ${errorMsg}`);
        }
      }

      // Adaptive connection polling with exponential backoff
      let pollInterval = 10000; // Start at 10 seconds
      let consecutiveFailures = 0;
      let pollTimeout: NodeJS.Timeout | undefined;

      const withJitter = (ms: number) => Math.round(ms * (0.9 + Math.random() * 0.2));
      const scheduleNextPoll = (delay: number = pollInterval) => {
        if (pollTimeout) {
          clearTimeout(pollTimeout);
        }

        pollTimeout = setTimeout(async () => {
          // Only poll if solution server is enabled and we should be connected
          const currentHubConfig = this.state.data.hubConfig;
          if (!currentHubConfig?.enabled || !currentHubConfig?.features.solutionServer.enabled) {
            // Pause; config change handlers will resume when re-enabled
            this.state.mutateServerState((draft) => {
              draft.solutionServerConnected = false;
            });
            return;
          }

          try {
            const solutionServerClient = this.state.hubConnectionManager.getSolutionServerClient();

            // If client doesn't exist, treat as disconnected
            if (!solutionServerClient) {
              throw new Error("Solution server client not available");
            }

            await solutionServerClient.getServerCapabilities(true);

            // Success - reset failure count and use base interval
            if (consecutiveFailures > 0) {
              this.state.logger.info(
                "Solution server connectivity restored; resuming 10s polling.",
              );
            }
            consecutiveFailures = 0;
            pollInterval = 10000;

            // If we get here, connection is working
            this.state.mutateServerState((draft) => {
              draft.solutionServerConnected = true;
            });
          } catch {
            consecutiveFailures++;
            // If we can't get capabilities, assume disconnected
            this.state.mutateServerState((draft) => {
              draft.solutionServerConnected = false;
            });

            // Exponential backoff: 10s -> 30s -> 60s (max)
            if (consecutiveFailures === 1) {
              pollInterval = 30000;
            } else if (consecutiveFailures >= 2) {
              pollInterval = 60000;
            }
          }

          // Schedule next poll unless we've had too many failures
          if (consecutiveFailures < 5) {
            scheduleNextPoll(withJitter(pollInterval));
          } else {
            // Stop polling after 5 consecutive failures - will resume on manual retry or config change
            this.state.logger.info(
              "Stopping connection polling after repeated failures. Will resume on demand.",
            );
          }
        }, delay);
      };

      // Start the adaptive polling
      scheduleNextPoll(withJitter(pollInterval));

      this.listeners.push({
        dispose: () => {
          if (pollTimeout) {
            clearTimeout(pollTimeout);
          }
        },
      });

      // Listen for extension changes to update Continue installation status
      this.listeners.push(
        vscode.extensions.onDidChange(() => {
          this.checkContinueInstalled();
        }),
      );

      // Listen for workspace folder changes to update workspace configuration errors
      this.listeners.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
          this.state.logger.info("Workspace folders changed!");
          vscode.window
            .showInformationMessage(
              "Workspace folders have changed. Please restart the Konveyor extension for changes to take effect.",
              "Restart Now",
            )
            .then((selection) => {
              if (selection === "Restart Now") {
                vscode.commands.executeCommand("workbench.action.reloadWindow");
              }
            });
        }),
      );

      registerAnalysisTrigger(this.listeners, this.state);

      this.listeners.push(
        vscode.workspace.onWillSaveTextDocument(async (event) => {
          const doc = event.document;

          // Auto-accept all diff decorations BEFORE saving (if enabled)
          // This ensures the document is saved in its final state
          if (getConfigAutoAcceptOnSave() && this.state.verticalDiffManager) {
            const fileUri = doc.uri.toString();
            const handler = this.state.verticalDiffManager.getHandlerForFile(fileUri);
            if (handler && handler.hasDiffForCurrentFile()) {
              try {
                // Accept all diffs BEFORE the save operation
                // This ensures the document is saved in its final state
                await this.state.staticDiffAdapter?.acceptAll(doc.uri.fsPath);
                this.state.logger.info(
                  `Auto-accepted all diff decorations for ${doc.fileName} before save`,
                );
                // Show user feedback that diffs were auto-accepted
                vscode.window.showInformationMessage(
                  `Auto-accepted all diff changes for ${doc.fileName} - saving final state`,
                );
              } catch (error) {
                this.state.logger.error(
                  `Failed to auto-accept diff decorations before save for ${doc.fileName}:`,
                  error,
                );
                vscode.window.showErrorMessage(
                  `Failed to auto-accept diff changes for ${doc.fileName}: ${error}`,
                );
              }
            }
          }
        }),
      );

      // Handle settings.yaml configuration changes AFTER save
      this.listeners.push(
        vscode.workspace.onDidSaveTextDocument(async (doc) => {
          if (doc.uri.fsPath === paths().settingsYaml.fsPath) {
            const configError = await this.setupModelProvider(paths().settingsYaml);
            this.state.mutateConfigErrors((draft) => {
              // Clear all config errors and re-validate
              draft.configErrors = [];
              if (configError) {
                draft.configErrors.push(configError);
              }
            });
          }
        }),
      );

      this.listeners.push(
        vscode.workspace.onDidChangeConfiguration(async (event) => {
          this.state.logger.info("Configuration modified!");

          if (
            event.affectsConfiguration(`${EXTENSION_NAME}.genai.demoMode`) ||
            event.affectsConfiguration(`${EXTENSION_NAME}.genai.cacheDir`) ||
            event.affectsConfiguration(`${EXTENSION_NAME}.genai.enabled`)
          ) {
            this.setupModelProvider(paths().settingsYaml)
              .then((configError) => {
                this.state.mutateConfigErrors((draft) => {
                  // Clear all GenAI-related config errors
                  draft.configErrors = draft.configErrors.filter(
                    (e) =>
                      e.type !== "genai-disabled" &&
                      e.type !== "provider-not-configured" &&
                      e.type !== "provider-connection-failed",
                  );

                  // Add new config error if one exists
                  if (configError) {
                    draft.configErrors.push(configError);
                  }
                });
              })
              .catch((error: Error) => {
                this.state.logger.error("Error setting up model provider:", error);
                this.state.mutateConfigErrors((draft) => {
                  // Clear all GenAI-related config errors
                  draft.configErrors = draft.configErrors.filter(
                    (e) =>
                      e.type !== "genai-disabled" &&
                      e.type !== "provider-not-configured" &&
                      e.type !== "provider-connection-failed",
                  );

                  // Add connection failed error
                  const configError = createConfigError.providerConnnectionFailed();
                  configError.error = error instanceof Error ? error.message : String(error);
                  draft.configErrors.push(configError);
                });
              });
          }

          if (event.affectsConfiguration(`${EXTENSION_NAME}.genai.agentMode`)) {
            const agentMode = getConfigAgentMode();
            this.state.mutateSettings((draft) => {
              draft.isAgentMode = agentMode;
            });
          }

          if (event.affectsConfiguration(`${EXTENSION_NAME}.logLevel`)) {
            this.state.logger.info("Log level configuration modified!");
            const newLogLevel = getConfigLogLevel();
            this.state.logger.level = newLogLevel;
            for (const transport of this.state.logger.transports) {
              transport.level = newLogLevel;
            }
            this.state.logger.info(`Log level changed to ${newLogLevel}`);
          }

          if (event.affectsConfiguration(`${EXTENSION_NAME}.analyzerPath`)) {
            this.state.logger.info("Analyzer path configuration modified!");

            // Check if server is currently running
            const wasServerRunning = this.state.analyzerClient.isServerRunning();

            // Stop server if it's running
            if (wasServerRunning) {
              this.state.logger.info("Stopping analyzer server for binary path change...");
              await this.state.analyzerClient.stop();
            }

            // Re-ensure the binary (this will validate and reset if needed)
            await ensureKaiAnalyzerBinary(this.context, this.state.logger);

            // Restart server if it was running before
            if (wasServerRunning) {
              this.state.logger.info("Restarting analyzer server after binary path change...");
              try {
                if (await this.state.analyzerClient.canAnalyzeInteractive()) {
                  await this.state.analyzerClient.start();
                }
              } catch (error) {
                this.state.logger.error("Error restarting analyzer server:", error);
                vscode.window.showErrorMessage(
                  `Failed to restart analyzer server after binary path change: ${error}`,
                );
              }
            }
          }
        }),
      );

      this.state.logger.info("Extension initialized");

      // Setup diff status bar item
      this.setupDiffStatusBar();
    } catch (error) {
      this.state.logger.error("Error initializing extension", error);
      vscode.window.showErrorMessage(`Failed to initialize Konveyor extension: ${error}`);
    }
  }

  private initializeVerticalDiff(): void {
    // Create file editor implementation
    const fileEditor = new FileEditor();

    // Initialize managers
    this.state.verticalDiffManager = new VerticalDiffManager(fileEditor, this.state);

    // Set up the diff status change callback
    this.state.verticalDiffManager.onDiffStatusChange = (fileUri: string) => {
      this.updateDiffStatusBarForFile(fileUri);
    };

    this.state.staticDiffAdapter = new StaticDiffAdapter(
      this.state.verticalDiffManager,
      this.state.logger,
    );

    this.state.logger.info("Vertical diff system initialized");
  }

  private setupDiffStatusBar(): void {
    this.diffStatusBarItem.name = "Konveyor Diff Status";
    this.diffStatusBarItem.tooltip = "Click to accept/reject all diff changes";
    this.diffStatusBarItem.command = `${EXTENSION_NAME}.showDiffActions`;
    this.diffStatusBarItem.hide();

    // Update status bar when active editor changes
    this.listeners.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.updateDiffStatusBar(editor);
      }),
    );

    // Initial update
    this.updateDiffStatusBar(vscode.window.activeTextEditor);
  }

  private updateDiffStatusBar(editor: vscode.TextEditor | undefined): void {
    if (!editor || !this.state.verticalDiffManager) {
      this.diffStatusBarItem.hide();
      return;
    }

    const fileUri = editor.document.uri.toString();
    const handler = this.state.verticalDiffManager.getHandlerForFile(fileUri);

    if (handler && handler.hasDiffForCurrentFile()) {
      const blocks = this.state.verticalDiffManager.fileUriToCodeLens.get(fileUri) || [];
      const totalGreen = blocks.reduce((sum, b) => sum + b.numGreen, 0);
      const totalRed = blocks.reduce((sum, b) => sum + b.numRed, 0);

      this.diffStatusBarItem.text = `$(diff) ${totalGreen}+ ${totalRed}-`;
      this.diffStatusBarItem.show();
    } else {
      this.diffStatusBarItem.hide();
    }
  }

  public updateDiffStatusBarForFile(fileUri: string): void {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri.toString() === fileUri) {
      this.updateDiffStatusBar(editor);
    }
  }

  private updateConfigurationErrors(draft: ExtensionData): void {
    // Clear profile-related errors first
    draft.configErrors = draft.configErrors.filter(
      (error) =>
        error.type !== "no-active-profile" &&
        error.type !== "invalid-label-selector" &&
        error.type !== "no-custom-rules",
    );

    // Update with current profile errors using the existing utility function
    updateConfigErrors(draft, this.paths.settingsYaml.fsPath);
  }

  private registerWebviewProvider(): void {
    const sidebarProvider = new KonveyorGUIWebviewViewProvider(this.state, "sidebar");
    const resolutionViewProvider = new KonveyorGUIWebviewViewProvider(this.state, "resolution");
    const profilesViewProvider = new KonveyorGUIWebviewViewProvider(this.state, "profiles");
    const hubViewProvider = new KonveyorGUIWebviewViewProvider(this.state, "hub");

    this.state.webviewProviders.set("sidebar", sidebarProvider);
    this.state.webviewProviders.set("resolution", resolutionViewProvider);
    this.state.webviewProviders.set("profiles", profilesViewProvider);
    this.state.webviewProviders.set("hub", hubViewProvider);

    this.context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        KonveyorGUIWebviewViewProvider.SIDEBAR_VIEW_TYPE,
        sidebarProvider,
        { webviewOptions: { retainContextWhenHidden: true } },
      ),
      vscode.window.registerWebviewViewProvider(
        KonveyorGUIWebviewViewProvider.RESOLUTION_VIEW_TYPE,
        resolutionViewProvider,
        { webviewOptions: { retainContextWhenHidden: true } },
      ),
      vscode.window.registerWebviewViewProvider(
        KonveyorGUIWebviewViewProvider.PROFILES_VIEW_TYPE,
        profilesViewProvider,
        {
          webviewOptions: { retainContextWhenHidden: true },
        },
      ),
    );
  }

  private registerCoreHealthChecks(): void {
    try {
      const { registerCoreHealthChecks } = require("./healthCheck");
      registerCoreHealthChecks(this.healthCheckRegistry);
      this.state.logger.info("Core health checks registered successfully");
    } catch (error) {
      this.state.logger.error("Error registering core health checks", error);
      // Don't throw - health checks are not critical for extension activation
    }
  }

  private registerCommands(): void {
    try {
      registerAllCommands(this.state);
      // Removed registerSuggestionCommands since we're using merge editor now
    } catch (error) {
      this.state.logger.error("Critical error during command registration", error);
      vscode.window.showErrorMessage(
        `Konveyor extension failed to register commands properly. The extension may not function correctly. Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Re-throw to indicate the extension is not in a good state
      throw error;
    }
  }

  private registerLanguageProviders(): void {
    const documentSelectors: vscode.DocumentSelector = [
      // Language IDs
      "java",
      "yaml",
      "properties",
      "groovy", // for Gradle files
      // Specific file patterns
      { pattern: "**/pom.xml" },
      { pattern: "**/build.gradle" },
      { pattern: "**/build.gradle.kts" },
    ];

    this.context.subscriptions.push(
      vscode.languages.registerCodeActionsProvider(
        documentSelectors,
        new ViolationCodeActionProvider(this.state),
        {
          providedCodeActionKinds: ViolationCodeActionProvider.providedCodeActionKinds,
        },
      ),
    );
  }

  private setupProfileWatcher(): void {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return;
    }

    // Watch for changes to .konveyor/profiles directory
    const profilesPattern = new vscode.RelativePattern(
      workspaceRoot,
      ".konveyor/profiles/**/profile.yaml",
    );
    const watcher = vscode.workspace.createFileSystemWatcher(profilesPattern);

    // Reload profiles when files change
    const reloadProfiles = async () => {
      this.state.logger.info("Detected changes to .konveyor/profiles, reloading profiles");
      const allProfiles = await getAllProfiles(this.context);
      const currentActiveId = this.state.data.activeProfileId;

      // Check if active profile still exists (handle null, undefined, or empty string)
      const hasActiveProfile = currentActiveId && currentActiveId.trim() !== "";
      const activeStillExists = hasActiveProfile
        ? allProfiles.find((p) => p.id === currentActiveId)
        : null;
      const newActiveId =
        activeStillExists?.id ?? (allProfiles.length > 0 ? allProfiles[0].id : null);

      // Update profiles first
      this.state.mutateProfiles((draft) => {
        draft.profiles = allProfiles;
        draft.activeProfileId = newActiveId;
      });

      // Persist active profile ID to workspace state if it changed
      if (currentActiveId !== newActiveId && newActiveId) {
        await this.context.workspaceState.update("activeProfileId", newActiveId);
      }

      // Then update configuration errors
      this.state.mutateConfigErrors((draft) => {
        this.updateConfigurationErrors(draft);
      });

      if (currentActiveId !== newActiveId) {
        this.state.logger.info(`Active profile changed to "${newActiveId}" after profile reload.`);
        vscode.window.showInformationMessage(
          `Active profile changed to "${allProfiles.find((p) => p.id === newActiveId)?.name ?? "none"}" after profile reload.`,
        );
      }
    };

    watcher.onDidCreate(reloadProfiles);
    watcher.onDidChange(reloadProfiles);
    watcher.onDidDelete(reloadProfiles);

    this.context.subscriptions.push(watcher);
  }

  private checkContinueInstalled(): void {
    const continueExt = vscode.extensions.getExtension("Continue.continue");
    this.state.mutateSettings((draft) => {
      draft.isContinueInstalled = !!continueExt;
    });
  }

  private async setupModelProvider(settingsPath: vscode.Uri): Promise<ConfigError | undefined> {
    const hadPreviousProvider = this.state.modelProvider !== undefined;

    // Check if GenAI is disabled via settings
    if (!getConfigGenAIEnabled()) {
      this.state.modelProvider = undefined;
      // Only dispose workflow if not fetching solution
      if (
        !this.state.data.isFetchingSolution &&
        this.state.workflowManager &&
        this.state.workflowManager.dispose
      ) {
        this.state.workflowManager.dispose();
        this.state.workflowDisposalPending = false;
      }
      return createConfigError.genaiDisabled();
    }

    // Check if Hub LLM proxy is available - if so, use it instead of local config
    const llmProxyConfig = this.state.hubConnectionManager.getLLMProxyConfig();
    if (llmProxyConfig?.available) {
      this.state.logger.info(
        "Hub LLM proxy is available, using Hub proxy instead of local config",
        {
          endpoint: llmProxyConfig.endpoint,
        },
      );

      try {
        this.state.modelProvider = await this.createHubProxyModelProvider(llmProxyConfig);

        // Clear GenAI/provider-related config errors now that we're using the Hub proxy
        this.state.mutateConfigErrors((draft) => {
          draft.configErrors = draft.configErrors.filter(
            (e) =>
              e.type !== "provider-not-configured" &&
              e.type !== "provider-connection-failed" &&
              e.type !== "genai-disabled",
          );
        });

        // Dispose workflow if we're changing an existing provider and not currently fetching
        if (
          hadPreviousProvider &&
          !this.state.data.isFetchingSolution &&
          this.state.workflowManager &&
          this.state.workflowManager.dispose
        ) {
          this.state.logger.info("Disposing workflow manager - switching to Hub LLM proxy");
          this.state.workflowManager.dispose();
          this.state.workflowDisposalPending = false;
        } else if (hadPreviousProvider && this.state.data.isFetchingSolution) {
          this.state.logger.info(
            "Hub proxy configured but workflow disposal deferred - solution in progress",
          );
          this.state.workflowDisposalPending = true;
          vscode.window.showInformationMessage(
            "Now using Hub LLM proxy. The proxy will be used for the next solution.",
          );
        }

        return undefined;
      } catch (err) {
        this.state.logger.error("Error setting up Hub LLM proxy provider:", err);
        this.state.modelProvider = undefined;

        const configError = createConfigError.providerConnnectionFailed();
        configError.error =
          err instanceof Error
            ? `Hub LLM Proxy: ${err.message.length > 150 ? err.message.slice(0, 150) + "..." : err.message}`
            : String(err);
        return configError;
      }
    }

    let modelConfig: ParsedModelConfig;
    try {
      modelConfig = await parseModelConfig(settingsPath);
    } catch (err) {
      this.state.logger.error("Error getting model config:", err);
      this.state.modelProvider = undefined;
      // Only dispose workflow if not fetching solution
      if (
        !this.state.data.isFetchingSolution &&
        this.state.workflowManager &&
        this.state.workflowManager.dispose
      ) {
        this.state.workflowManager.dispose();
        this.state.workflowDisposalPending = false;
      }

      const configError = createConfigError.providerNotConfigured();
      configError.error = err instanceof Error ? err.message : String(err);
      return configError;
    }

    try {
      this.state.logger.info("About to run getModelProviderFromConfig", {
        hadPreviousProvider,
        demoMode: getConfigKaiDemoMode(),
        cacheDir: getCacheDir(this.data.workspaceRoot),
      });
      this.state.modelProvider = await getModelProviderFromConfig(
        modelConfig,
        this.state.logger,
        getConfigKaiDemoMode() ? getCacheDir(this.data.workspaceRoot) : undefined,
        getTraceEnabled() ? getTraceDir(this.data.workspaceRoot) : undefined,
      );

      // Dispose workflow if we're changing an existing provider and not currently fetching
      if (
        hadPreviousProvider &&
        !this.state.data.isFetchingSolution &&
        this.state.workflowManager &&
        this.state.workflowManager.dispose
      ) {
        this.state.logger.info("Disposing workflow manager - provider configuration changed");
        this.state.workflowManager.dispose();
        this.state.workflowDisposalPending = false;
      } else if (hadPreviousProvider && this.state.data.isFetchingSolution) {
        this.state.logger.info(
          "Provider updated but workflow disposal deferred - solution in progress",
        );
        this.state.workflowDisposalPending = true;
        vscode.window.showInformationMessage(
          "Model provider updated. The new provider will be used for the next solution.",
        );
      }

      return undefined;
    } catch (err) {
      this.state.logger.error("Error running model health check:", err);
      this.state.modelProvider = undefined;
      this.state.logger.error("Health check failed, setting modelProvider to undefined", {
        error: err,
        demoMode: getConfigKaiDemoMode(),
      });
      // Only dispose workflow if not fetching solution
      if (
        !this.state.data.isFetchingSolution &&
        this.state.workflowManager &&
        this.state.workflowManager.dispose
      ) {
        this.state.workflowManager.dispose();
        this.state.workflowDisposalPending = false;
      }

      const configError = createConfigError.providerConnnectionFailed();
      configError.error =
        err instanceof Error
          ? err.message.length > 150
            ? err.message.slice(0, 150) + "..."
            : err.message
          : String(err);
      return configError;
    }
  }

  /**
   * Create a model provider configured to use Hub's LLM proxy
   */
  private async createHubProxyModelProvider(llmProxyConfig: {
    available: boolean;
    endpoint: string;
    model?: string;
  }): Promise<KaiModelProvider> {
    const bearerToken = this.state.hubConnectionManager.getBearerToken();
    if (!bearerToken) {
      throw new Error("No bearer token available for Hub LLM proxy authentication");
    }

    this.state.logger.info("Creating Hub LLM proxy model provider", {
      endpoint: llmProxyConfig.endpoint,
      model: llmProxyConfig.model,
      hasToken: !!bearerToken,
    });

    // Create OpenAI-compatible chat models pointing to Hub proxy
    // Use model from Hub configuration, fallback to gpt-4o if not specified
    const modelName = llmProxyConfig.model || "gpt-4o";

    const streamingModel = new ChatOpenAI({
      openAIApiKey: bearerToken, // Use JWT as API key
      configuration: {
        baseURL: llmProxyConfig.endpoint, // Point to Hub's proxy endpoint
      },
      modelName,
      temperature: 0,
      streaming: true,
    });

    const nonStreamingModel = new ChatOpenAI({
      openAIApiKey: bearerToken,
      configuration: {
        baseURL: llmProxyConfig.endpoint,
      },
      modelName,
      temperature: 0,
      streaming: false,
    });

    // Set up cache and tracer directories
    const cacheDir = getConfigKaiDemoMode() ? getCacheDir(this.data.workspaceRoot) : undefined;
    const traceDir = getTraceEnabled() ? getTraceDir(this.data.workspaceRoot) : undefined;

    const subDir = (dir: string): string =>
      pathlib.join(dir, "hub-proxy", modelName.replace(/[^a-zA-Z0-9_-]/g, "_"));

    const cache = getCacheForModelProvider(
      getConfigKaiDemoMode(),
      this.state.logger,
      subDir(cacheDir ?? ""),
    );
    const tracer = getCacheForModelProvider(
      getTraceEnabled(),
      this.state.logger,
      subDir(traceDir ?? ""),
      true,
    );

    // Assume Hub proxy supports tools (it's OpenAI-compatible)
    let capabilities = {
      supportsTools: true,
      supportsToolsInStreaming: true,
    };

    // Check if we have cached healthcheck in demo mode
    if (getConfigKaiDemoMode()) {
      this.state.logger.info("Checking for cached Hub proxy healthcheck");
      const cachedHealthcheck = await cache.get("capabilities", {
        cacheSubDir: "healthcheck",
      });
      if (cachedHealthcheck && typeof (cachedHealthcheck as BaseMessage).content === "string") {
        capabilities = JSON.parse((cachedHealthcheck as BaseMessage).content as string);
        this.state.logger.info("Using cached Hub proxy capabilities", capabilities);
      }
    }

    const options: ModelProviderOptions = {
      streamingModel,
      nonStreamingModel,
      capabilities,
      logger: this.state.logger,
      cache,
      tracer,
    };

    return new BaseModelProvider(options);
  }

  public async dispose() {
    // Clean up pending interactions and resolver function to prevent memory leaks
    this.state.resolvePendingInteraction = undefined;
    this.state.mutateSolutionWorkflow((draft) => {
      draft.isWaitingForUserInteraction = false;
    });

    // Dispose workflow manager
    if (this.state.workflowManager && this.state.workflowManager.dispose) {
      try {
        this.state.workflowManager.dispose();
      } catch (error) {
        this.state.logger.error("Error disposing workflow manager:", error);
      }
    }

    // Decoration managers removed - using vertical diff system
    // Cleanup is handled by vertical diff manager

    await this.state.analyzerClient?.stop();
    await this.state.hubConnectionManager?.disconnect().catch((error: Error) => {
      this.state.logger.error("Error disconnecting from Hub", error);
    });

    // Update state to reflect disconnected status
    this.state.mutateServerState((draft) => {
      draft.solutionServerConnected = false;
    });

    const disposables = this.listeners.splice(0, this.listeners.length);
    for (const disposable of disposables) {
      disposable.dispose();
    }
  }
}

let extension: VsCodeExtension | undefined;
let providerRegistry: ProviderRegistry | undefined;
let healthCheckRegistry: HealthCheckRegistry | undefined;

/**
 * Get the health check registry (for use in commands)
 */
export function getHealthCheckRegistry(): HealthCheckRegistry | undefined {
  return healthCheckRegistry;
}

export async function activate(context: vscode.ExtensionContext): Promise<KonveyorCoreApi> {
  // Logger is our bae...before anything else
  const outputChannel = vscode.window.createOutputChannel(EXTENSION_DISPLAY_NAME);
  const logger = winston.createLogger({
    level: getConfigLogLevel(),
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json(),
    ),
    transports: [
      new winston.transports.File({
        filename: vscode.Uri.joinPath(context.logUri, "extension.log").fsPath,
        maxsize: 10 * 1024 * 1024, // 10MB
        maxFiles: 3,
      }),
      new OutputChannelTransport({
        outputChannel,
      }),
    ],
  });

  logger.info("Logger created");
  logger.info(`Extension ${EXTENSION_ID} starting`, { buildInfo: BUILD_INFO });

  try {
    const paths = await ensurePaths(context, logger);
    await copySampleProviderSettings();

    // Create registries
    providerRegistry = new ProviderRegistry(logger);
    context.subscriptions.push(providerRegistry);

    healthCheckRegistry = new HealthCheckRegistry(logger);
    context.subscriptions.push(healthCheckRegistry);

    extension = new VsCodeExtension(paths, context, logger, providerRegistry, healthCheckRegistry);
    await extension.initialize();

    // Create and return the API for language extensions
    const api = createCoreApi(providerRegistry, healthCheckRegistry, EXTENSION_VERSION);
    logger.info("Core extension API created and ready for language extensions", {
      version: EXTENSION_VERSION,
    });
    return api;
  } catch (error) {
    await extension?.dispose();
    extension = undefined;
    providerRegistry?.dispose();
    providerRegistry = undefined;
    healthCheckRegistry?.dispose();
    healthCheckRegistry = undefined;
    logger.error("Failed to activate Konveyor extension", error);
    vscode.window.showErrorMessage(`Failed to activate Konveyor extension: ${error}`);
    throw error; // Re-throw to ensure VS Code marks the extension as failed to activate
  }
}

export async function deactivate(): Promise<void> {
  try {
    // Clean up diff system managers to prevent resource leaks
    if (extension?.state?.verticalDiffManager) {
      await extension.state.verticalDiffManager.dispose();
      extension.state.verticalDiffManager = undefined;
    }

    if (extension?.state?.staticDiffAdapter) {
      //Disposal and lifecycle is handled by vertical diff manager
      extension.state.staticDiffAdapter = undefined;
    }

    // Clean up any active webview panels
    KonveyorGUIWebviewViewProvider.disposeAllPanels();

    // Clean up the main extension
    await extension?.dispose();
  } catch (error) {
    console.error("Error during extension deactivation:", error);
  } finally {
    extension = undefined;
  }
}
