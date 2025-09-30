import "./resolutionsPage.css";
import React, { useMemo, useCallback } from "react";
import { Page, PageSection, PageSidebar, PageSidebarBody, Title } from "@patternfly/react-core";
import { CheckCircleIcon } from "@patternfly/react-icons";
import {
  ChatMessage,
  ChatMessageType,
  Incident,
  type ToolMessageValue,
  type ModifiedFileMessageValue,
} from "@editor-extensions/shared";
import { openFile } from "../../hooks/actions";
import { IncidentTableGroup } from "../IncidentTable/IncidentTableGroup";
import { SentMessage } from "./SentMessage";
import { ReceivedMessage } from "./ReceivedMessage";
import { ToolMessage } from "./ToolMessage";
import { ModifiedFileMessage } from "./ModifiedFile";
import { useExtensionStateContext } from "../../context/ExtensionStateContext";
import { Chatbot, ChatbotContent, ChatbotDisplayMode, MessageBox } from "@patternfly/chatbot";
import { ChatCard } from "./ChatCard/ChatCard";
import LoadingIndicator from "./LoadingIndicator";
import { MessageWrapper } from "./MessageWrapper";
import { useScrollManagement } from "../../hooks/useScrollManagement";

// Unified hook for both modes
const useResolutionData = (state: any) => {
  const {
    chatMessages = [],
    solutionState = "none",
    solutionScope,
    isFetchingSolution = false,
    isAnalyzing,
  } = state;

  const isTriggeredByUser = useMemo(
    () => Array.isArray(solutionScope?.incidents) && solutionScope?.incidents?.length > 0,
    [solutionScope?.incidents],
  );

  const hasNothingToView = useMemo(() => {
    return solutionState === "none" && (!Array.isArray(chatMessages) || chatMessages?.length === 0);
  }, [solutionState, chatMessages]);

  const hasContent = useMemo(() => {
    return (
      solutionState === "received" || (Array.isArray(chatMessages) && chatMessages?.length > 0)
    );
  }, [solutionState, chatMessages]);

  const hasResponseWithErrors = useMemo(
    () => false, // No longer tracking solution response errors
    [solutionState],
  );

  return {
    isTriggeredByUser,
    hasNothingToView,
    hasContent,
    hasResponseWithErrors,
    chatMessages,
    isFetchingSolution,
    isAnalyzing,
    solutionState,
  };
};

// Component for rendering user request messages
const UserRequestMessages: React.FC<{
  solutionScope: any;
  onIncidentClick: (incident: Incident) => void;
  isReadOnly: boolean;
}> = ({ solutionScope, onIncidentClick, isReadOnly }) => {
  const USER_REQUEST_MESSAGES: ChatMessage[] = [
    {
      kind: ChatMessageType.String,
      value: { message: "Here is the scope of what I would like you to fix:" },
      messageToken: "1",
      timestamp: new Date().toISOString(),
      extraContent: (
        <ChatCard color="yellow">
          <IncidentTableGroup
            onIncidentSelect={onIncidentClick}
            incidents={solutionScope?.incidents || []}
            isReadOnly={isReadOnly}
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

  return (
    <>
      {USER_REQUEST_MESSAGES.map((msg) => (
        <MessageWrapper key={msg.messageToken}>
          <SentMessage
            timestamp={msg.timestamp}
            content={msg.value.message as string}
            extraContent={msg.extraContent}
          />
        </MessageWrapper>
      ))}
    </>
  );
};

const ResolutionPage: React.FC = () => {
  const { state, dispatch } = useExtensionStateContext();
  const { solutionScope } = state;

  // Unified data hook
  const { isTriggeredByUser, hasNothingToView, chatMessages, isFetchingSolution, isAnalyzing } =
    useResolutionData(state);

  const { messageBoxRef, triggerScrollOnUserAction } = useScrollManagement(
    chatMessages,
    isFetchingSolution,
  );

  // Event handlers
  const handleIncidentClick = (incident: Incident) =>
    dispatch(openFile(incident.uri, incident.lineNumber ?? 0));

  // Render chat messages
  const renderChatMessages = useCallback(() => {
    if (!Array.isArray(chatMessages) || chatMessages?.length === 0) {
      return null;
    }

    return chatMessages.map((msg) => {
      if (!msg) {
        return null;
      }

      if (msg.kind === ChatMessageType.Tool) {
        const { toolName, toolStatus } = msg.value as ToolMessageValue;
        return (
          <MessageWrapper key={msg.messageToken}>
            <ToolMessage
              toolName={toolName}
              status={toolStatus as "succeeded" | "failed" | "running"}
              timestamp={msg.timestamp}
            />
          </MessageWrapper>
        );
      }

      if (msg.kind === ChatMessageType.ModifiedFile) {
        const fileData = msg.value as ModifiedFileMessageValue;
        return (
          <MessageWrapper key={msg.messageToken}>
            <ModifiedFileMessage
              data={fileData}
              timestamp={msg.timestamp}
              onUserAction={triggerScrollOnUserAction}
            />
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
  }, [chatMessages, isFetchingSolution, isAnalyzing, triggerScrollOnUserAction]);

  return (
    <Page
      className="resolutions-page"
      sidebar={
        <PageSidebar isSidebarOpen={false}>
          <PageSidebarBody />
        </PageSidebar>
      }
    >
      <PageSection>
        <Title headingLevel="h1" size="2xl" style={{ display: "flex", alignItems: "center" }}>
          Generative AI Results
          {isFetchingSolution && <LoadingIndicator />}
          {!isFetchingSolution && (
            <CheckCircleIcon style={{ marginLeft: "10px", color: "green" }} />
          )}
        </Title>
      </PageSection>
      <Chatbot displayMode={ChatbotDisplayMode.embedded}>
        <ChatbotContent>
          <MessageBox ref={messageBoxRef} style={{ paddingBottom: "2rem" }}>
            {/* User request messages - shown in both modes when triggered by user */}
            {isTriggeredByUser && (
              <UserRequestMessages
                solutionScope={solutionScope}
                onIncidentClick={handleIncidentClick}
                isReadOnly={true}
              />
            )}

            {/* No content to view */}
            {hasNothingToView && (
              <MessageWrapper>
                <ReceivedMessage content="No resolutions available." />
              </MessageWrapper>
            )}

            {/* Render all content */}
            {renderChatMessages()}
          </MessageBox>
        </ChatbotContent>
      </Chatbot>
    </Page>
  );
};

export default ResolutionPage;
