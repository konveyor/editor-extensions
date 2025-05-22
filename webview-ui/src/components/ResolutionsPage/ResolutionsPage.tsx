import "./resolutionsPage.css";
import React, { useRef, useCallback, useEffect } from "react";
import { Page, PageSection, PageSidebar, PageSidebarBody, Title } from "@patternfly/react-core";
import { FileChanges } from "./FileChanges";
import { ChatMessage, ChatMessageType, Incident, LocalChange } from "@editor-extensions/shared";
import { applyFile, discardFile, openFile, viewFix } from "../../hooks/actions";
import { IncidentTableGroup } from "../IncidentTable/IncidentTableGroup";
import { SentMessage } from "./SentMessage";
import { ReceivedMessage } from "./ReceivedMessage";
import { useExtensionStateContext } from "../../context/ExtensionStateContext";
import {
  Chatbot,
  ChatbotContent,
  ChatbotDisplayMode,
  MessageBox,
  MessageBoxHandle,
} from "@patternfly/chatbot";
import { ChatCard } from "./ChatCard/ChatCard";

const ResolutionPage: React.FC = () => {
  const { state, dispatch } = useExtensionStateContext();
  const {
    localChanges,
    isFetchingSolution,
    solutionData: resolution,
    solutionScope,
    chatMessages,
    solutionState,
  } = state;

  const messageBoxRef = useRef<MessageBoxHandle>(null);
  const scrollQueued = useRef(false);
  const scrollTimeoutRef = useRef<number | null>(null);
  const lastScrollTime = useRef<number>(0);

  const isNearBottom = useCallback(() => {
    const messageBox = document.querySelector(".pf-chatbot__messagebox");
    if (!messageBox) {
      return false;
    }

    const { scrollTop, scrollHeight, clientHeight } = messageBox;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    return distanceFromBottom < 100; // Consider "near bottom" if within 100px
  }, []);

  const scrollToBottom = useCallback(
    (force = false) => {
      const messageBox = document.querySelector(".pf-chatbot__messagebox");
      if (!messageBox) {
        return;
      }

      // Clear any existing timeout
      if (scrollTimeoutRef.current) {
        window.clearTimeout(scrollTimeoutRef.current);
      }

      // Only scroll if we're near bottom or force is true
      if (force || isNearBottom()) {
        const now = Date.now();
        // Prevent too frequent scrolls (at least 50ms apart)
        if (now - lastScrollTime.current < 50) {
          scrollTimeoutRef.current = window.setTimeout(() => {
            messageBox.scrollTop = messageBox.scrollHeight;
            lastScrollTime.current = Date.now();
            scrollQueued.current = false;
          }, 50);
        } else {
          messageBox.scrollTop = messageBox.scrollHeight;
          lastScrollTime.current = now;
          scrollQueued.current = false;
        }
      }
    },
    [isNearBottom],
  );

  // Handle new messages and content updates
  useEffect(() => {
    if (chatMessages.length > 0) {
      // Force scroll on new messages
      scrollToBottom(true);
    }
  }, [chatMessages, scrollToBottom]);

  // Set up scroll listener to track when user manually scrolls
  useEffect(() => {
    const messageBox = document.querySelector(".pf-chatbot__messagebox");
    if (!messageBox) {
      return;
    }

    const handleScroll = () => {
      if (!isNearBottom()) {
        scrollQueued.current = false;
      }
    };

    messageBox.addEventListener("scroll", handleScroll);
    return () => {
      messageBox.removeEventListener("scroll", handleScroll);
    };
  }, [isNearBottom]);

  // Force scroll periodically while content is being updated
  useEffect(() => {
    if (isFetchingSolution) {
      const interval = setInterval(() => {
        scrollToBottom(true);
      }, 100);

      return () => clearInterval(interval);
    }
  }, [isFetchingSolution, scrollToBottom]);

  const getRemainingFiles = () =>
    resolution ? localChanges.filter(({ state }) => state === "pending") : [];

  const isTriggeredByUser = !!solutionScope?.incidents?.length;
  const isHistorySolution = !isTriggeredByUser && !!localChanges.length;

  const isResolved =
    solutionState === "received" && localChanges.length !== 0 && getRemainingFiles().length === 0;

  const hasResponseWithErrors =
    solutionState === "received" && !!resolution?.encountered_errors?.length;

  const hasResponse =
    (solutionState === "received" || isHistorySolution) && localChanges.length > 0;

  const hasEmptyResponse = solutionState === "received" && localChanges.length === 0;

  const hasNothingToView = solutionState === "none" && localChanges.length === 0;

  const handleFileClick = (change: LocalChange) => dispatch(viewFix(change));
  const handleAcceptClick = (change: LocalChange) => dispatch(applyFile(change));
  const handleRejectClick = (change: LocalChange) => dispatch(discardFile(change));
  const handleIncidentClick = (incident: Incident) =>
    dispatch(openFile(incident.uri, incident.lineNumber ?? 0));

  const USER_REQUEST_MESSAGES: ChatMessage[] = [
    {
      kind: ChatMessageType.String,
      value: { message: "Here is the scope of what I would like you to fix:" },
      messageToken: "1",
      timestamp: new Date().toISOString(),
      extraContent: (
        <ChatCard color="yellow">
          <IncidentTableGroup
            onIncidentSelect={handleIncidentClick}
            incidents={solutionScope?.incidents}
          />
        </ChatCard>
      ),
    },
    {
      kind: ChatMessageType.String,
      value: { message: "Please provide resolution for this issue." },
      messageToken: "2",
      timestamp: new Date().toISOString(),
    },
  ];

  const renderedResolutionRequestMessages = (
    <>
      {USER_REQUEST_MESSAGES.map((msg) => (
        <SentMessage
          key={msg.messageToken}
          timestamp={msg.timestamp}
          content={msg.value.message as string}
          extraContent={msg.extraContent}
        />
      ))}
    </>
  );

  return (
    <Page
      sidebar={
        <PageSidebar isSidebarOpen={false}>
          <PageSidebarBody />
        </PageSidebar>
      }
    >
      <PageSection>
        <Title headingLevel="h1" size="2xl">
          Kai Results
        </Title>
      </PageSection>
      <Chatbot displayMode={ChatbotDisplayMode.embedded}>
        <ChatbotContent>
          <MessageBox ref={messageBoxRef} enableSmartScroll style={{ paddingBottom: "2rem" }}>
            {isTriggeredByUser && renderedResolutionRequestMessages}

            {hasNothingToView && <ReceivedMessage content="No resolutions available." />}

            {isHistorySolution && <ReceivedMessage content="Loaded last known resolution." />}

            {chatMessages.map((msg) => (
              <ReceivedMessage
                timestamp={msg.timestamp}
                key={msg.value.message as string}
                content={msg.value.message as string}
                quickResponses={msg.quickResponses?.map((response) => ({
                  ...response,
                  messageToken: msg.messageToken,
                }))}
              />
            ))}

            {hasResponse && (
              <ReceivedMessage
                extraContent={
                  <FileChanges
                    changes={getRemainingFiles()}
                    onFileClick={handleFileClick}
                    onApplyFix={handleAcceptClick}
                    onRejectChanges={handleRejectClick}
                  />
                }
              />
            )}

            {hasEmptyResponse && !hasResponseWithErrors && (
              <ReceivedMessage content="Received response contains no resolutions" />
            )}

            {hasResponseWithErrors && (
              <ReceivedMessage
                content="Response contains errors"
                extraContent={
                  <ul>
                    {Object.entries(
                      resolution!.encountered_errors.reduce<Record<string, number>>(
                        (acc, error) => {
                          acc[error] = (acc[error] || 0) + 1;
                          return acc;
                        },
                        {},
                      ),
                    ).map(([errorText, count], index) => (
                      <li key={index}>
                        {errorText} {count > 1 && `(x${count})`}
                      </li>
                    ))}
                  </ul>
                }
              />
            )}

            {isResolved && !isFetchingSolution && (
              <ReceivedMessage content="All resolutions have been applied" />
            )}
          </MessageBox>
        </ChatbotContent>
      </Chatbot>
    </Page>
  );
};

export default ResolutionPage;
