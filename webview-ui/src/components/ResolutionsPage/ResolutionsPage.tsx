import "./resolutionsPage.css";
import React, { useEffect, useRef } from "react";
import { Page, PageSection, PageSidebar, PageSidebarBody, Title } from "@patternfly/react-core";
import { FileChanges } from "./FileChanges";
import { ChatMessage, ChatMessageType, Incident, LocalChange } from "@editor-extensions/shared";
import { applyFile, discardFile, openFile, viewFix } from "../../hooks/actions";
import { IncidentTableGroup } from "../IncidentTable/IncidentTableGroup";
import { SentMessage } from "./SentMessage";
import { ReceivedMessage } from "./ReceivedMessage";
import { useExtensionStateContext } from "../../context/ExtensionStateContext";
import { Chatbot, ChatbotContent, ChatbotDisplayMode, MessageBox } from "@patternfly/chatbot";
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

  // We keep a ref to the bottom element to scroll chat
  const scrollToBottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the chat window
  useEffect(() => {
    if (state.chatMessages.length > 2) {
      scrollToBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [state.chatMessages]);

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
          <MessageBox>
            {isTriggeredByUser && renderedResolutionRequestMessages}

            {hasNothingToView && <ReceivedMessage content="No resolutions available." />}

            {isHistorySolution && <ReceivedMessage content="Loaded last known resolution." />}

            {chatMessages.map((msg) => (
              <ReceivedMessage
                timestamp={msg.timestamp}
                key={msg.value.message as string}
                content={msg.value.message as string}
              />
            ))}

            {isFetchingSolution && <ReceivedMessage isLoading />}

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

            <div ref={scrollToBottomRef} />
          </MessageBox>
        </ChatbotContent>
      </Chatbot>
    </Page>
  );
};

export default ResolutionPage;
