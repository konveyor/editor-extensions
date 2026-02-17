import React, { useState, useRef, useEffect, useCallback } from "react";
import { Message, MessageBar, Chatbot, ChatbotContent, ChatbotDisplayMode } from "@patternfly/chatbot";
import { useExtensionStore } from "../../store/store";
import { SentMessage } from "../ResolutionsPage/SentMessage";
import { ReceivedMessage } from "../ResolutionsPage/ReceivedMessage";
import { v4 as uuidv4 } from "uuid";
import avatar from "../../../public/avatarIcons/avatar.svg?inline";
import "./ChatPage.css";

const ChatPage: React.FC = () => {
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
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

      // Add user message to local store
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

      // Send to extension
      window.vscode.postMessage({
        type: "GOOSE_SEND_MESSAGE",
        payload: { content, messageId },
      });

      setInputValue("");
      setIsSending(true);
    },
    [gooseState],
  );

  // Reset sending state when streaming completes
  useEffect(() => {
    const lastMsg = gooseMessages[gooseMessages.length - 1];
    if (lastMsg && lastMsg.role === "assistant" && !lastMsg.isStreaming) {
      setIsSending(false);
    }
  }, [gooseMessages]);

  const handleStartAgent = useCallback(() => {
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
            <div className="chat-error-banner">{gooseError}</div>
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
                return (
                  <ReceivedMessage
                    key={msg.id}
                    content={msg.content}
                    timestamp={msg.timestamp}
                    isLoading={msg.isStreaming}
                  />
                );
              }

              return null;
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="chat-input-area">
            <MessageBar
              onSendMessage={(message) => {
                handleSend(String(message));
              }}
              hasAttachButton={false}
              isSendButtonDisabled={!isRunning || isSending}
            />
          </div>
        </div>
      </ChatbotContent>
    </Chatbot>
  );
};

export default ChatPage;
