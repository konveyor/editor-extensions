import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Chatbot,
  ChatbotContent,
  ChatbotDisplayMode,
  ChatbotFooter,
  ChatbotFootnote,
  MessageBox,
} from "@patternfly/chatbot";
import {
  ChatMessage,
  ChatMessageType,
  Incident,
  AGENT_SEND_MESSAGE,
  AGENT_CANCEL_GENERATION,
  type AgentChatMessage,
  type ToolMessageValue,
  type ModifiedFileMessageValue,
} from "@editor-extensions/shared";
import { useExtensionStore } from "../../store/store";
import { openFile, enableGenAI } from "../../hooks/actions";
import { sendVscodeMessage as dispatch } from "../../utils/vscodeMessaging";
import { ReceivedMessage } from "../ResolutionsPage/ReceivedMessage";
import { ToolMessage, CollapsibleToolGroup } from "../ResolutionsPage/ToolMessage";
import { MessageWrapper } from "../ResolutionsPage/MessageWrapper";
import { CompactModifiedFile } from "./CompactModifiedFile";
import LoadingIndicator from "../ResolutionsPage/LoadingIndicator";
import CompactMigrationScope from "./CompactMigrationScope";
import { useScrollManagement } from "../../hooks/useScrollManagement";
import { useContainerWidth } from "../../hooks/useContainerWidth";
import AgentSettings from "./AgentSettings";
import { CompactBatchReview } from "./CompactBatchReview";
import { PermissionReviewMessage } from "./PermissionReviewMessage";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { ResourceLink } from "./ResourceLink";
import { ResourceBlock } from "./ResourceBlock";
import "./ChatPage.css";

const MIN_USABLE_WIDTH = 200;

type RenderItem =
  | { type: "tool-group"; tools: ChatMessage[]; key: string }
  | { type: "message"; message: ChatMessage };

const ChatPage: React.FC = () => {
  const [showSettings, setShowSettings] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const { containerRef, isTooNarrow } = useContainerWidth(MIN_USABLE_WIDTH);

  const experimentalChatEnabled = useExtensionStore((s) => s.experimentalChatEnabled);
  const agentState = useExtensionStore((s) => s.agentState);
  const agentError = useExtensionStore((s) => s.agentError);
  const agentConfig = useExtensionStore((s) => s.agentConfig);
  const agentMessages = useExtensionStore((s) => s.agentMessages);

  const configErrors = useExtensionStore((s) => s.configErrors);
  const modelSupportsTools = useExtensionStore((s) => s.modelSupportsTools);
  const chatMessages = useExtensionStore((s) => s.chatMessages);
  const solutionScope = useExtensionStore((s) => s.solutionScope);
  const isFetchingSolution = useExtensionStore((s) => s.isFetchingSolution);
  const isAnalyzing = useExtensionStore((s) => s.isAnalyzing);
  const analysisProgressMessage = useExtensionStore((s) => s.analysisProgressMessage);
  const enhancedIncidents = useExtensionStore((s) => s.enhancedIncidents);
  const ruleSets = useExtensionStore((s) => s.ruleSets);
  const analysisProgress = useExtensionStore((s) => s.analysisProgress);
  const isProcessing = isFetchingSolution || isAnalyzing;
  const hasWorkflowContent = Array.isArray(chatMessages) && chatMessages.length > 0;
  const incidentCount = enhancedIncidents.length;
  const isTriggeredByUser =
    Array.isArray(solutionScope?.incidents) && solutionScope!.incidents.length > 0;

  const { messageBoxRef } = useScrollManagement(chatMessages, isProcessing, agentMessages.length);

  const isAgentStreaming = agentMessages.some((m) => m.isStreaming);

  const handleIncidentClick = (incident: Incident) =>
    dispatch(openFile(incident.uri, incident.lineNumber ?? 0));

  const handleStartAgent = useCallback(() => {
    const store = useExtensionStore.getState();
    if (store.agentState === "error") {
      store.setAgentError(undefined);
    }
    window.vscode.postMessage({ type: "AGENT_START", payload: {} });
  }, []);

  const handleStopAgent = useCallback(() => {
    window.vscode.postMessage({ type: "AGENT_STOP", payload: {} });
  }, []);

  const handleToggleView = useCallback(() => {
    window.vscode.postMessage({ type: "AGENT_TOGGLE_VIEW", payload: {} });
  }, []);

  const handleCancelGeneration = useCallback(() => {
    if (isFetchingSolution) {
      return;
    }
    window.vscode.postMessage({ type: AGENT_CANCEL_GENERATION, payload: {} });
  }, [isFetchingSolution]);

  const handleClearChat = useCallback(() => {
    if (isFetchingSolution) {
      return;
    }
    const store = useExtensionStore.getState();
    store.setAgentMessages([]);
    store.clearChatMessages();
  }, [isFetchingSolution]);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || agentState !== "running" || isFetchingSolution) {
        return;
      }

      const store = useExtensionStore.getState();
      const userMessage: AgentChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: trimmed,
        timestamp: new Date().toISOString(),
      };
      store.setAgentMessages([...store.agentMessages, userMessage]);

      const responseId = `resp-${Date.now()}`;
      window.vscode.postMessage({
        type: AGENT_SEND_MESSAGE,
        payload: { content: trimmed, messageId: responseId },
      });
      setChatInput("");
      chatInputRef.current?.focus();
    },
    [agentState, isFetchingSolution],
  );

  const handleSendMessage = useCallback(() => {
    sendMessage(chatInput);
  }, [chatInput, sendMessage]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    },
    [handleSendMessage],
  );

  const isRunning = agentState === "running";
  const isStarting = agentState === "starting";
  const isError = agentState === "error";

  const configLabel =
    agentConfig?.provider && agentConfig?.model
      ? `${agentConfig.provider} / ${agentConfig.model}`
      : "Not configured";

  const providerNotConfigured = configErrors.some((e) => e.type === "provider-not-configured");
  const providerConnectionFailed = configErrors.some(
    (e) => e.type === "provider-connection-failed",
  );
  const genaiDisabled = configErrors.some((e) => e.type === "genai-disabled");

  const renderItems = useMemo((): RenderItem[] => {
    if (!hasWorkflowContent) {
      return [];
    }

    const items: RenderItem[] = [];
    let toolBuffer: ChatMessage[] = [];

    const flushTools = () => {
      if (toolBuffer.length > 0) {
        items.push({
          type: "tool-group",
          tools: toolBuffer,
          key: toolBuffer[0].messageToken,
        });
        toolBuffer = [];
      }
    };

    for (const msg of chatMessages) {
      if (!msg) {
        continue;
      }
      if (msg.kind === ChatMessageType.Tool) {
        toolBuffer.push(msg);
      } else {
        flushTools();
        items.push({ type: "message", message: msg });
      }
    }
    flushTools();

    return items;
  }, [chatMessages, hasWorkflowContent]);

  const renderChatMessages = useCallback(() => {
    return renderItems.map((item) => {
      if (item.type === "tool-group") {
        const { tools, key } = item;
        const hasRunning = tools.some(
          (t) => (t.value as ToolMessageValue).toolStatus === "running",
        );
        const hasFailed = tools.some((t) => (t.value as ToolMessageValue).toolStatus === "failed");

        if (hasRunning) {
          const runningCount = tools.filter(
            (t) => (t.value as ToolMessageValue).toolStatus === "running",
          ).length;
          return (
            <MessageWrapper key={key}>
              <ToolMessage
                toolName={
                  runningCount === 1
                    ? "Running tool call..."
                    : `Running ${runningCount} tool calls...`
                }
                status="running"
              />
            </MessageWrapper>
          );
        }

        return <CollapsibleToolGroup key={key} tools={tools} hasFailed={hasFailed || undefined} />;
      }

      const msg = item.message;

      if (msg.kind === ChatMessageType.ModifiedFile) {
        const fileData = msg.value as ModifiedFileMessageValue;
        return (
          <MessageWrapper key={msg.messageToken}>
            <CompactModifiedFile data={fileData} timestamp={msg.timestamp} />
          </MessageWrapper>
        );
      }

      if (msg.kind === ChatMessageType.String) {
        const message = msg.value?.message as string;
        const selectedResponse = msg.selectedResponse;

        if (msg.messageToken.startsWith("perm-")) {
          return (
            <MessageWrapper key={msg.messageToken}>
              <PermissionReviewMessage
                content={message}
                timestamp={msg.timestamp}
                quickResponses={
                  Array.isArray(msg.quickResponses) && msg.quickResponses.length > 0
                    ? msg.quickResponses.map((response) => ({
                        ...response,
                        messageToken: msg.messageToken,
                        isSelected: selectedResponse === response.id,
                      }))
                    : undefined
                }
              />
            </MessageWrapper>
          );
        }

        return (
          <MessageWrapper key={msg.messageToken}>
            <ReceivedMessage
              timestamp={msg.timestamp}
              content={message}
              quickResponses={
                Array.isArray(msg.quickResponses) && msg.quickResponses.length > 0
                  ? msg.quickResponses.map((response) => ({
                      ...response,
                      messageToken: msg.messageToken,
                      isDisabled: response.id === "run-analysis" && isAnalyzing,
                      isSelected: selectedResponse === response.id,
                    }))
                  : undefined
              }
            />
          </MessageWrapper>
        );
      }

      return null;
    });
  }, [renderItems, isAnalyzing]);

  const renderAgentMessages = useCallback(() => {
    return agentMessages.map((msg) => {
      if (msg.role === "user") {
        return (
          <div key={msg.id} className="agent-chat-msg agent-chat-msg--user">
            <div className="agent-chat-msg__content">{msg.content}</div>
          </div>
        );
      }

      if (msg.role === "system") {
        return (
          <div key={msg.id} className="chat-system-message">
            <span className="chat-system-message__icon">✓</span>
            <span className="chat-system-message__text">{msg.content}</span>
          </div>
        );
      }

      if (msg.toolCall) {
        const statusLabel =
          msg.toolCall.status === "running"
            ? "running"
            : msg.toolCall.status === "failed"
              ? "failed"
              : "succeeded";
        return (
          <MessageWrapper key={msg.id}>
            <ToolMessage
              toolName={msg.toolCall.name}
              status={statusLabel}
              detail={msg.toolCall.result}
            />
          </MessageWrapper>
        );
      }

      const thinkingBlocks =
        msg.contentBlocks?.filter((b) => b.type === "thinking") ?? [];
      const resourceLinks =
        msg.contentBlocks?.filter((b) => b.type === "resource_link") ?? [];
      const resourceBlocks =
        msg.contentBlocks?.filter((b) => b.type === "resource") ?? [];

      if (msg.isThinking && !msg.content) {
        const lastThinking = thinkingBlocks[thinkingBlocks.length - 1];
        return (
          <MessageWrapper key={msg.id}>
            <ThinkingIndicator
              thinkingText={lastThinking?.type === "thinking" ? lastThinking.text : undefined}
            />
          </MessageWrapper>
        );
      }

      const extraContent =
        resourceLinks.length > 0 || resourceBlocks.length > 0 ? (
          <div className="agent-content-blocks">
            {resourceLinks.map((block, i) =>
              block.type === "resource_link" ? (
                <ResourceLink key={`rl-${i}`} block={block} />
              ) : null,
            )}
            {resourceBlocks.map((block, i) =>
              block.type === "resource" ? (
                <ResourceBlock key={`rb-${i}`} block={block} />
              ) : null,
            )}
          </div>
        ) : undefined;

      return (
        <MessageWrapper key={msg.id}>
          <ReceivedMessage
            content={msg.content || undefined}
            timestamp={msg.timestamp}
            isLoading={msg.isStreaming && !msg.content}
            extraContent={
              <>
                {extraContent}
                {msg.isCancelled && (
                  <span className="agent-cancelled-label">Generation cancelled</span>
                )}
              </>
            }
          />
        </MessageWrapper>
      );
    });
  }, [agentMessages]);

  const hasAgentContent = agentMessages.length > 0;
  const lastAgentMsg = agentMessages[agentMessages.length - 1];
  const isWaitingForResponse =
    hasAgentContent && lastAgentMsg?.role === "user" && !isAgentStreaming;

  const activeToolName = useMemo(() => {
    for (let i = agentMessages.length - 1; i >= 0; i--) {
      const msg = agentMessages[i];
      if (msg.toolCall?.status === "running") {
        return msg.toolCall.name;
      }
    }
    return undefined;
  }, [agentMessages]);

  const isBusy = isAgentStreaming || isWaitingForResponse;

  return (
    <div ref={containerRef} className="chat-page-container">
      {isTooNarrow ? (
        <div className="chat-too-narrow">
          <div className="chat-too-narrow__icon">⇔</div>
          <p className="chat-too-narrow__title">Panel too narrow</p>
          <p className="chat-too-narrow__hint">
            Drag the sidebar edge to widen this panel, or use the{" "}
            <button className="chat-too-narrow__move-btn" onClick={handleToggleView}>
              ⇔ Move to editor
            </button>{" "}
            button to open in a larger area.
          </p>
        </div>
      ) : (
        <Chatbot displayMode={ChatbotDisplayMode.embedded}>
          <ChatbotContent>
            <div className="chat-page">
              {experimentalChatEnabled && (
                <div className="chat-status-bar">
                  <span
                    className={`chat-status-dot ${isRunning ? "running" : isStarting ? "starting" : isError ? "error" : "stopped"}`}
                  />
                  <span className="chat-status-text">
                    {isRunning
                      ? "Migration Assistant"
                      : isStarting
                        ? "Starting..."
                        : isError
                          ? "Error"
                          : "Stopped"}
                    {isProcessing && <LoadingIndicator />}
                  </span>
                  {incidentCount > 0 && !isAnalyzing && (
                    <span
                      className="chat-incident-badge"
                      title={`${incidentCount} incident${incidentCount !== 1 ? "s" : ""} across ${ruleSets.length} rule set${ruleSets.length !== 1 ? "s" : ""}`}
                    >
                      {incidentCount}
                    </span>
                  )}
                  {isAnalyzing && analysisProgress > 0 && (
                    <span className="chat-analysis-pct" title="Analysis progress">
                      {Math.round(analysisProgress)}%
                    </span>
                  )}
                  <span className="chat-config-label" title={configLabel}>
                    {configLabel}
                  </span>
                  {!isRunning && !isStarting && (
                    <button className="chat-action-btn" onClick={handleStartAgent}>
                      Start
                    </button>
                  )}
                  {isRunning && !isFetchingSolution && (
                    <button className="chat-action-btn" onClick={handleStopAgent}>
                      Stop
                    </button>
                  )}
                  {(hasAgentContent || hasWorkflowContent) && !isFetchingSolution && (
                    <button
                      className="chat-action-btn chat-action-btn--icon"
                      onClick={handleClearChat}
                      aria-label="New conversation"
                      title="Clear chat and start a new conversation"
                    >
                      +
                    </button>
                  )}
                  <button
                    className="chat-action-btn chat-action-btn--icon"
                    onClick={() => setShowSettings((prev) => !prev)}
                    aria-label="Settings"
                    title="Configure provider, model, and extensions"
                  >
                    ⚙
                  </button>
                  <button
                    className="chat-action-btn chat-action-btn--icon"
                    onClick={handleToggleView}
                    aria-label="Toggle view position"
                    title="Move between sidebar and panel"
                  >
                    ⇔
                  </button>
                </div>
              )}

              {!experimentalChatEnabled && (
                <div className="chat-status-bar">
                  <span className="chat-status-text">
                    Migration Assistant
                    {isProcessing && <LoadingIndicator />}
                  </span>
                  <button
                    className="chat-action-btn chat-action-btn--icon"
                    onClick={() => setShowSettings((prev) => !prev)}
                    aria-label="Settings"
                    title="Configure provider and model"
                  >
                    ⚙
                  </button>
                </div>
              )}

              {showSettings && <AgentSettings onClose={() => setShowSettings(false)} />}

              {experimentalChatEnabled && isError && agentError && (
                <div className="chat-error-banner">
                  <div className="chat-error-banner__message">{agentError}</div>
                  {agentError.includes("binary not found") ? (
                    <div className="chat-error-banner__actions">
                      <button
                        className="chat-error-banner__btn"
                        onClick={() => {
                          window.vscode.postMessage({ type: "AGENT_INSTALL_CLI", payload: {} });
                        }}
                      >
                        Install Goose CLI
                      </button>
                      <span className="chat-error-banner__hint">
                        or{" "}
                        <button
                          className="chat-error-banner__link"
                          onClick={() => {
                            window.vscode.postMessage({
                              type: "AGENT_OPEN_SETTINGS",
                              payload: {},
                            });
                          }}
                        >
                          set the path manually
                        </button>
                      </span>
                    </div>
                  ) : (
                    <div className="chat-error-banner__hint">Click Start to retry.</div>
                  )}
                </div>
              )}

              {genaiDisabled && (
                <div className="chat-warning-banner">
                  <div className="chat-warning-banner__message">
                    GenAI is disabled. Enable it to use AI-powered migration assistance.
                  </div>
                  <div className="chat-warning-banner__hint">
                    <button
                      className="chat-warning-banner__link"
                      onClick={() => dispatch(enableGenAI())}
                    >
                      Enable GenAI
                    </button>
                  </div>
                </div>
              )}

              {!genaiDisabled && providerNotConfigured && (
                <div className="chat-warning-banner">
                  <div className="chat-warning-banner__message">
                    LLM provider is not configured. Set up a provider and model to get started.
                  </div>
                  <div className="chat-warning-banner__hint">
                    <button
                      className="chat-warning-banner__link"
                      onClick={() => setShowSettings(true)}
                    >
                      Open settings
                    </button>
                  </div>
                </div>
              )}

              {!genaiDisabled && providerConnectionFailed && (
                <div className="chat-error-banner">
                  <div className="chat-error-banner__message">
                    Failed to connect to the LLM provider. Check your credentials and try again.
                  </div>
                  <div className="chat-error-banner__hint">
                    <button
                      className="chat-error-banner__link"
                      onClick={() => setShowSettings(true)}
                    >
                      Open settings
                    </button>
                  </div>
                </div>
              )}

              {!modelSupportsTools && (hasWorkflowContent || isProcessing) && (
                <div className="chat-warning-banner">
                  <div className="chat-warning-banner__message">
                    Your model does not support tool calling. File changes may not be detected
                    reliably. Consider upgrading your model or enabling Agent Mode.
                  </div>
                  <div className="chat-warning-banner__hint">
                    <button
                      className="chat-warning-banner__link"
                      onClick={() => setShowSettings(true)}
                    >
                      Open settings
                    </button>
                  </div>
                </div>
              )}

              <CompactBatchReview />
              <div className="chat-messages-area">
                <MessageBox ref={messageBoxRef} className="chat-messages">
                  {isTriggeredByUser && solutionScope && (
                    <div className="chat-initial-scope">
                      <div className="chat-initial-scope__header">Migration Scope</div>
                      <div className="chat-initial-scope__body">
                        <CompactMigrationScope
                          incidents={solutionScope.incidents || []}
                          onIncidentSelect={handleIncidentClick}
                        />
                      </div>
                    </div>
                  )}

                  {!hasWorkflowContent && !hasAgentContent && !isProcessing && (
                    <div className="chat-agent-status">
                      {experimentalChatEnabled && isRunning ? (
                        <>
                          <p className="chat-agent-status__hint">
                            Ask the Migration Assistant anything, or try a suggestion:
                          </p>
                          <div className="chat-suggestions">
                            {[
                              { label: "Run Analysis", prompt: "Run the Konveyor analyzer on my project and summarize the results." },
                              { label: "Summarize Incidents", prompt: "What migration issues currently exist in this project? Give me a summary." },
                              { label: "Plan Migration", prompt: "Help me plan a migration strategy for this project based on the analysis." },
                              { label: "Explain a Rule", prompt: "Explain the most common migration rule violations in my project and how to fix them." },
                            ].map((s) => (
                              <button
                                key={s.label}
                                className="chat-suggestion-chip"
                                onClick={() => sendMessage(s.prompt)}
                              >
                                {s.label}
                              </button>
                            ))}
                          </div>
                        </>
                      ) : isStarting ? (
                        <p className="chat-agent-status__hint">Starting agent...</p>
                      ) : (
                        <p className="chat-agent-status__hint">
                          Use <strong>Get Solution</strong> from the analysis view to start a
                          migration workflow.
                        </p>
                      )}
                    </div>
                  )}

                  {renderChatMessages()}
                  {experimentalChatEnabled && renderAgentMessages()}
                  {experimentalChatEnabled && isAnalyzing && (
                    <div className="chat-analysis-indicator">
                      <div className="chat-analysis-indicator__header">
                        <LoadingIndicator />
                        <span className="chat-analysis-indicator__label">
                          {analysisProgressMessage || "Running analysis..."}
                        </span>
                        {analysisProgress > 0 && (
                          <span className="chat-analysis-indicator__pct">
                            {Math.round(analysisProgress)}%
                          </span>
                        )}
                      </div>
                      {analysisProgress > 0 && (
                        <div className="chat-analysis-indicator__bar">
                          <div
                            className="chat-analysis-indicator__fill"
                            style={{ width: `${Math.min(analysisProgress, 100)}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                  {experimentalChatEnabled && isBusy && !isFetchingSolution && (
                    <div className="chat-response-indicator">
                      <span className="chat-response-indicator__dot" />
                      <span className="chat-response-indicator__dot" />
                      <span className="chat-response-indicator__dot" />
                      <span className="chat-response-indicator__label">
                        {activeToolName
                          ? `Running: ${activeToolName}`
                          : isAgentStreaming
                            ? "Responding..."
                            : "Waiting for response..."}
                      </span>
                      <button
                        className="chat-response-indicator__cancel"
                        onClick={handleCancelGeneration}
                        aria-label="Cancel generation"
                        title="Stop the current response"
                      >
                        Stop
                      </button>
                    </div>
                  )}
                  {experimentalChatEnabled && isFetchingSolution && (
                    <div className="chat-solution-indicator">
                      <LoadingIndicator />
                      <span className="chat-solution-indicator__label">
                        Working on migration fix — chat is paused
                      </span>
                    </div>
                  )}
                </MessageBox>
              </div>
            </div>
          </ChatbotContent>

          {experimentalChatEnabled && isRunning ? (
            <ChatbotFooter>
              <div
                className={`chat-input-area ${isBusy ? "chat-input-area--busy" : ""}`}
              >
                {isBusy && (
                  <div className="chat-input-area__progress" />
                )}
                <textarea
                  ref={chatInputRef}
                  className="chat-input-area__textarea"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder={
                    isFetchingSolution
                      ? "Chat paused — migration fix in progress..."
                      : isBusy
                        ? "Type to interrupt and send a new message..."
                        : "Ask the Migration Assistant..."
                  }
                  rows={1}
                  disabled={!isRunning || isFetchingSolution}
                />
                <button
                  className="chat-input-area__send"
                  onClick={handleSendMessage}
                  disabled={!chatInput.trim() || !isRunning || isFetchingSolution}
                  aria-label="Send message"
                  title={
                    isFetchingSolution
                      ? "Chat paused during migration fix"
                      : isBusy
                        ? "Send message (will cancel current response)"
                        : "Send message (Enter)"
                  }
                >
                  {isBusy ? "⏹" : "↑"}
                </button>
              </div>
              <ChatbotFootnote
                className="footnote"
                label="Always review AI generated content prior to use."
              />
            </ChatbotFooter>
          ) : hasWorkflowContent ? (
            <ChatbotFooter>
              <ChatbotFootnote
                className="footnote"
                label="Always review AI generated content prior to use."
              />
            </ChatbotFooter>
          ) : null}
        </Chatbot>
      )}
    </div>
  );
};

export default ChatPage;
