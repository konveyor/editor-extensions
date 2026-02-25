import React, { useRef, useEffect, useCallback } from "react";
import { Message, MessageBar, Chatbot, ChatbotContent, ChatbotDisplayMode } from "@patternfly/chatbot";
import { useExtensionStore } from "../../store/store";
import { SentMessage } from "../ResolutionsPage/SentMessage";
import { ReceivedMessage } from "../ResolutionsPage/ReceivedMessage";
import { ResourceLink } from "./ResourceLink";
import { ResourceBlock } from "./ResourceBlock";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { ToolCallIndicator } from "./ToolCallIndicator";
import { v4 as uuidv4 } from "uuid";
import type { GooseChatMessage } from "@editor-extensions/shared";
import avatar from "../../../public/avatarIcons/avatar.svg?inline";
import "./ChatPage.css";

const ContentBlocks: React.FC<{ msg: GooseChatMessage }> = ({ msg }) => {
  if (!msg.contentBlocks || msg.contentBlocks.length === 0) {
    return null;
  }

  return (
    <div className="goose-content-blocks">
      {msg.contentBlocks.map((block, i) => {
        switch (block.type) {
          case "resource_link":
            return <ResourceLink key={`rl-${i}`} block={block} />;
          case "resource":
            return <ResourceBlock key={`r-${i}`} block={block} />;
          case "thinking":
            return <ThinkingBlock key={`t-${i}`} text={block.text} />;
          default:
            return null;
        }
      })}
    </div>
  );
};

const ChatPage: React.FC = () => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const gooseMessages = useExtensionStore((s) => s.gooseMessages);
  const gooseState = useExtensionStore((s) => s.gooseState);
  const gooseError = useExtensionStore((s) => s.gooseError);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [gooseMessages, scrollToBottom]);

  const handleSend = useCallback(
    (value: string) => {
      const content = value.trim();
      if (!content || gooseState !== "running") {
        return;
      }

      const messageId = uuidv4();

      const store = useExtensionStore.getState();
      store.setGooseMessages([
        ...store.gooseMessages,
        {
          id: uuidv4(),
          role: "user",
          content,
          timestamp: new Date().toISOString(),
        },
      ]);

      window.vscode.postMessage({
        type: "GOOSE_SEND_MESSAGE",
        payload: { content, messageId },
      });
    },
    [gooseState],
  );

  const handleStartAgent = useCallback(() => {
    const store = useExtensionStore.getState();
    if (store.gooseState === "error") {
      store.setGooseError(undefined);
    }
    window.vscode.postMessage({
      type: "GOOSE_START_AGENT",
      payload: {},
    });
  }, []);

  const handleStopAgent = useCallback(() => {
    window.vscode.postMessage({
      type: "GOOSE_STOP_AGENT",
      payload: {},
    });
  }, []);

  const isRunning = gooseState === "running";
  const isStarting = gooseState === "starting";
  const isError = gooseState === "error";

  return (
    <Chatbot displayMode={ChatbotDisplayMode.embedded}>
      <ChatbotContent>
        <div className="chat-page">
          {/* Status bar */}
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
          </div>

          {/* Error display */}
          {isError && gooseError && (
            <div className="chat-error-banner">
              <div className="chat-error-banner__message">{gooseError}</div>
              <div className="chat-error-banner__hint">
                Click Start to retry. Your conversation history is preserved.
              </div>
            </div>
          )}

          {/* Welcome message when no messages */}
          {gooseMessages.length === 0 && isRunning && (
            <div className="chat-welcome">
              <Message
                name="Migration Assistant"
                role="bot"
                avatar={avatar}
                content={
                  "Hello! I'm your Migration Assistant powered by Goose. " +
                  "I can help you analyze your project for migration issues, " +
                  "review violations, and build a migration plan.\n\n" +
                  "Try asking me to:\n" +
                  "- **Run analysis** on your project\n" +
                  "- **Review analysis results** and summarize findings\n" +
                  "- **Create a migration plan** based on the violations found\n"
                }
              />
            </div>
          )}

          {/* Messages */}
          <div className="chat-messages">
            {gooseMessages.map((msg) => {
              if (msg.role === "user") {
                return (
                  <SentMessage
                    key={msg.id}
                    content={msg.content}
                    timestamp={msg.timestamp}
                  />
                );
              }

              if (msg.role === "assistant") {
                const hasContentBlocks =
                  msg.contentBlocks && msg.contentBlocks.length > 0;

                const thinkingText = msg.contentBlocks
                  ?.filter((b) => b.type === "thinking")
                  .map((b) => b.text)
                  .join("\n");

                const hasToolCall = !!msg.toolCall;
                const showExtra =
                  hasContentBlocks || msg.isCancelled || msg.isThinking || hasToolCall;

                const extraContent = showExtra
                  ? {
                      afterMainContent: (
                        <>
                          {msg.isThinking && <ThinkingIndicator />}
                          {hasToolCall && (
                            <ToolCallIndicator
                              name={msg.toolCall!.name}
                              status={msg.toolCall!.status}
                              result={msg.toolCall!.result}
                            />
                          )}
                          <ContentBlocks msg={msg} />
                          {msg.isCancelled && (
                            <div className="goose-cancelled-label">
                              Generation cancelled
                            </div>
                          )}
                        </>
                      ),
                    }
                  : undefined;

                return (
                  <ReceivedMessage
                    key={msg.id}
                    content={msg.content || (msg.isThinking ? " " : "")}
                    timestamp={msg.timestamp}
                    isLoading={msg.isStreaming}
                    extraContent={extraContent}
                  />
                );
              }

              return null;
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Input — send button enabled during streaming to allow cancel-and-send */}
          <div className="chat-input-area">
            <MessageBar
              onSendMessage={(message) => {
                handleSend(String(message));
              }}
              hasAttachButton={false}
              isSendButtonDisabled={!isRunning}
            />
          </div>
        </div>
      </ChatbotContent>
    </Chatbot>
  );
};

export default ChatPage;
