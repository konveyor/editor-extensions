import React, { useCallback, useMemo, useState } from "react";
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
  type ToolMessageValue,
  type ModifiedFileMessageValue,
} from "@editor-extensions/shared";
import { useExtensionStore } from "../../store/store";
import { openFile } from "../../hooks/actions";
import { sendVscodeMessage as dispatch } from "../../utils/vscodeMessaging";
import { ReceivedMessage } from "../ResolutionsPage/ReceivedMessage";
import { ToolMessage } from "../ResolutionsPage/ToolMessage";
import { MessageWrapper } from "../ResolutionsPage/MessageWrapper";
import { CompactModifiedFile } from "./CompactModifiedFile";
import LoadingIndicator from "../ResolutionsPage/LoadingIndicator";
import CompactMigrationScope from "./CompactMigrationScope";
import { useScrollManagement } from "../../hooks/useScrollManagement";
import { useContainerWidth } from "../../hooks/useContainerWidth";
import AgentSettings from "./AgentSettings";
import "./ChatPage.css";

const MIN_USABLE_WIDTH = 200;

type RenderItem =
  | { type: "tool-group"; tools: ChatMessage[]; key: string }
  | { type: "message"; message: ChatMessage };

const ChatPage: React.FC = () => {
  const [showSettings, setShowSettings] = useState(false);
  const { containerRef, isTooNarrow } = useContainerWidth(MIN_USABLE_WIDTH);

  const agentState = useExtensionStore((s) => s.agentState);
  const agentError = useExtensionStore((s) => s.agentError);
  const agentConfig = useExtensionStore((s) => s.agentConfig);

  const chatMessages = useExtensionStore((s) => s.chatMessages);
  const solutionScope = useExtensionStore((s) => s.solutionScope);
  const isFetchingSolution = useExtensionStore((s) => s.isFetchingSolution);
  const isAnalyzing = useExtensionStore((s) => s.isAnalyzing);
  const isProcessing = isFetchingSolution;
  const hasWorkflowContent = Array.isArray(chatMessages) && chatMessages.length > 0;
  const isTriggeredByUser =
    Array.isArray(solutionScope?.incidents) && solutionScope!.incidents.length > 0;

  const { messageBoxRef } = useScrollManagement(chatMessages, isProcessing);

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

  const isRunning = agentState === "running";
  const isStarting = agentState === "starting";
  const isError = agentState === "error";

  const configLabel =
    agentConfig?.provider && agentConfig?.model
      ? `${agentConfig.provider} / ${agentConfig.model}`
      : "Not configured";

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

        if (hasFailed) {
          return (
            <MessageWrapper key={key}>
              <ToolMessage
                toolName={
                  tools.length === 1
                    ? "Tool call failed"
                    : `${tools.length} tool calls (some failed)`
                }
                status="failed"
              />
            </MessageWrapper>
          );
        }

        return (
          <div key={key} className="tool-calls-summary">
            {tools.map((t) => {
              const val = t.value as ToolMessageValue;
              return (
                <ToolMessage
                  key={t.messageToken}
                  toolName={val.toolName}
                  status="succeeded"
                  detail={val.detail}
                />
              );
            })}
          </div>
        );
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
                <span className="chat-config-label" title={configLabel}>
                  {configLabel}
                </span>
                {!isRunning && !isStarting && (
                  <button className="chat-action-btn" onClick={handleStartAgent}>
                    Start
                  </button>
                )}
                {isRunning && (
                  <button className="chat-action-btn" onClick={handleStopAgent}>
                    Stop
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

              {showSettings && <AgentSettings onClose={() => setShowSettings(false)} />}

              {isError && agentError && (
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

                {!hasWorkflowContent && !isProcessing && (
                  <div className="chat-agent-status">
                    {isRunning ? (
                      <p className="chat-agent-status__hint">
                        Use <strong>Get Solution</strong> from the analysis view to start a
                        migration workflow. Goose will handle the code changes.
                      </p>
                    ) : isStarting ? (
                      <p className="chat-agent-status__hint">Starting Goose agent...</p>
                    ) : (
                      <p className="chat-agent-status__hint">
                        Start the Goose agent to enable AI-powered migration workflows.
                      </p>
                    )}
                  </div>
                )}

                {renderChatMessages()}
              </MessageBox>
            </div>
          </ChatbotContent>
          {hasWorkflowContent && (
            <ChatbotFooter>
              <ChatbotFootnote
                className="footnote"
                label="Always review AI generated content prior to use."
              />
            </ChatbotFooter>
          )}
        </Chatbot>
      )}
    </div>
  );
};

export default ChatPage;
