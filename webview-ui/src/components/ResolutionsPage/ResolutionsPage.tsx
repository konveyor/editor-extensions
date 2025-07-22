import "./resolutionsPage.css";
import React, { useMemo, useCallback } from "react";
import { Page, PageSection, PageSidebar, PageSidebarBody, Title } from "@patternfly/react-core";
import { CheckCircleIcon } from "@patternfly/react-icons";
import {
  ChatMessage,
  ChatMessageType,
  Incident,
  LocalChange,
  type ToolMessageValue,
  type ModifiedFileMessageValue,
} from "@editor-extensions/shared";
import {
  applyFile,
  ApplyFilePayload,
  discardFile,
  DiscardFilePayload,
  openFile,
  viewFix,
} from "../../hooks/actions";
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
    localChanges = [],
    solutionState = "none",
    solutionScope,
    solutionData: resolution,
    isFetchingSolution = false,
    isAnalyzing,
    isAgentMode = false,
  } = state;

  const isTriggeredByUser = useMemo(
    () => Array.isArray(solutionScope?.incidents) && solutionScope?.incidents?.length > 0,
    [solutionScope?.incidents],
  );

  const hasNothingToView = useMemo(() => {
    if (isAgentMode) {
      return (
        solutionState === "none" && (!Array.isArray(chatMessages) || chatMessages?.length === 0)
      );
    } else {
      // Non-agentic mode: Nothing to view if we have no chat messages AND no local changes
      return (
        solutionState === "none" &&
        (!Array.isArray(chatMessages) || chatMessages?.length === 0) &&
        (!Array.isArray(localChanges) || localChanges?.length === 0)
      );
    }
  }, [solutionState, chatMessages, localChanges, isAgentMode]);

  const getPendingLocalChanges = useCallback(() => {
    return Array.isArray(localChanges)
      ? localChanges.filter(({ state }) => state === "pending")
      : [];
  }, [localChanges]);

  const isHistorySolution = useMemo(() => {
    return (
      !isTriggeredByUser && !isAgentMode && Array.isArray(localChanges) && localChanges?.length > 0
    );
  }, [isTriggeredByUser, isAgentMode, localChanges]);

  const hasContent = useMemo(() => {
    if (isAgentMode) {
      return (
        solutionState === "received" || (Array.isArray(chatMessages) && chatMessages?.length > 0)
      );
    } else {
      // Non-agentic mode: Has content if there are chat messages OR local changes
      return (
        solutionState === "received" ||
        isHistorySolution ||
        (Array.isArray(chatMessages) && chatMessages?.length > 0) ||
        (Array.isArray(localChanges) && localChanges?.length > 0)
      );
    }
  }, [solutionState, chatMessages, localChanges, isAgentMode, isHistorySolution]);

  const getCompletionStatus = useCallback(() => {
    // NEVER show completion status in agent mode
    if (isAgentMode) {
      return null;
    }

    if (!Array.isArray(localChanges) || localChanges.length === 0) {
      return null;
    }

    const pendingChanges = getPendingLocalChanges();
    const allProcessed = solutionState === "received" && pendingChanges.length === 0;

    if (!allProcessed) {
      return null;
    }

    const appliedChanges = localChanges.filter((change) => change.state === "applied");
    const rejectedChanges = localChanges.filter((change) => change.state === "discarded");

    if (appliedChanges.length === localChanges.length) {
      return "all-applied";
    } else if (rejectedChanges.length === localChanges.length) {
      return "all-rejected";
    } else {
      return "mixed";
    }
  }, [isAgentMode, localChanges, getPendingLocalChanges, solutionState]);

  const hasResponseWithErrors = useMemo(
    () =>
      solutionState === "received" &&
      resolution !== undefined &&
      resolution !== null &&
      Array.isArray(resolution.encountered_errors) &&
      resolution.encountered_errors?.length > 0,
    [solutionState, resolution],
  );

  return {
    isAgentMode,
    isTriggeredByUser,
    hasNothingToView,
    hasContent,
    isHistorySolution,
    getPendingLocalChanges,
    getCompletionStatus,
    hasResponseWithErrors,
    resolution,
    chatMessages,
    localChanges,
    isFetchingSolution,
    isAnalyzing,
    solutionState,
  };
};

// Component for rendering user request messages
const UserRequestMessages: React.FC<{
  solutionScope: any;
  onIncidentClick: (incident: Incident) => void;
}> = ({ solutionScope, onIncidentClick }) => {
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
  const {
    isAgentMode,
    isTriggeredByUser,
    hasNothingToView,
    hasContent,
    isHistorySolution,
    getPendingLocalChanges,
    getCompletionStatus,
    hasResponseWithErrors,
    resolution,
    chatMessages,
    localChanges,
    isFetchingSolution,
    isAnalyzing,
    solutionState,
  } = useResolutionData(state);

  const { messageBoxRef, triggerScrollOnUserAction } = useScrollManagement(
    chatMessages,
    isFetchingSolution,
    localChanges,
    isAgentMode,
  );

  // Event handlers
  const handleFileClick = (change: LocalChange) => dispatch(viewFix(change));
  const handleAcceptClick = (change: LocalChange) => {
    const applyFilePayload: ApplyFilePayload = {
      path:
        typeof change.originalUri === "string"
          ? change.originalUri
          : change.originalUri.fsPath || "",
      messageToken: change.messageToken,
      content: change.content,
    };
    dispatch(applyFile(applyFilePayload));
    // Trigger scroll after accepting change
    triggerScrollOnUserAction();
  };
  const handleRejectClick = (change: LocalChange) => {
    const discardFilePayload: DiscardFilePayload = {
      path:
        typeof change.originalUri === "string"
          ? change.originalUri
          : change.originalUri.fsPath || "",
      messageToken: change.messageToken,
    };
    dispatch(discardFile(discardFilePayload));
    // Trigger scroll after rejecting change
    triggerScrollOnUserAction();
  };
  const handleIncidentClick = (incident: Incident) =>
    dispatch(openFile(incident.uri, incident.lineNumber ?? 0));

  // Render chat messages - used in both modes but with different ModifiedFile handling
  const renderChatMessages = useCallback(
    (mode: "agent" | "non-agent" = "agent") => {
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
          // In non-agentic mode, ModifiedFile messages are handled separately via localChanges
          // In agentic mode, they're rendered here
          if (mode === "agent") {
            const fileData = msg.value as ModifiedFileMessageValue;
            return (
              <MessageWrapper key={msg.messageToken}>
                <ModifiedFileMessage
                  data={fileData}
                  timestamp={msg.timestamp}
                  mode="agent"
                  onUserAction={triggerScrollOnUserAction}
                />
              </MessageWrapper>
            );
          }
          return null; // Skip in non-agentic mode
        }

        if (msg.kind === ChatMessageType.String) {
          const message = msg.value?.message as string;
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
                      }))
                    : undefined
                }
              />
            </MessageWrapper>
          );
        }

        return null;
      });
    },
    [chatMessages, isFetchingSolution, isAnalyzing],
  );

  // Render local changes for non-agent mode
  const renderLocalChanges = useCallback(() => {
    const pendingChanges = getPendingLocalChanges();
    const completionStatus = getCompletionStatus();

    return (
      <>
        {isHistorySolution && <ReceivedMessage content="Loaded last known resolution." />}

        {pendingChanges.map((change, index) => (
          <ModifiedFileMessage
            key={`${change.originalUri.fsPath}-${index}`}
            data={change}
            mode="non-agent"
            onApply={handleAcceptClick}
            onReject={handleRejectClick}
            onView={handleFileClick}
          />
        ))}

        {/* Show "no file changes" only when solution is received but has no local changes */}
        {solutionState === "received" && pendingChanges.length === 0 && !completionStatus && (
          <ReceivedMessage content="No file changes available in the solution." />
        )}

        {hasResponseWithErrors && resolution && Array.isArray(resolution.encountered_errors) && (
          <ReceivedMessage
            content="Response contains errors"
            extraContent={
              <ul>
                {resolution.encountered_errors?.length > 0 &&
                  Object.entries(
                    resolution.encountered_errors.reduce((acc: Record<string, number>, error) => {
                      if (error) {
                        acc[error] = (acc[error] || 0) + 1;
                      }
                      return acc;
                    }, {}),
                  ).map(([errorText, count], index) => (
                    <li key={index}>
                      {errorText} {(count as number) > 1 && `(x${count})`}
                    </li>
                  ))}
              </ul>
            }
          />
        )}

        {completionStatus && !isFetchingSolution && (
          <ReceivedMessage
            content={
              completionStatus === "all-applied"
                ? "All resolutions have been applied"
                : completionStatus === "all-rejected"
                  ? "All resolutions have been rejected"
                  : "All resolutions have been processed (some applied, some rejected)"
            }
          />
        )}
      </>
    );
  }, [
    getPendingLocalChanges,
    getCompletionStatus,
    isHistorySolution,
    hasContent,
    hasResponseWithErrors,
    resolution,
    isFetchingSolution,
    solutionState,
    handleAcceptClick,
    handleRejectClick,
    handleFileClick,
  ]);

  return (
    <Page
      sidebar={
        <PageSidebar isSidebarOpen={false}>
          <PageSidebarBody />
        </PageSidebar>
      }
    >
      <PageSection>
        <Title headingLevel="h1" size="2xl" style={{ display: "flex", alignItems: "center" }}>
          Kai Results
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
              />
            )}

            {/* No content to view */}
            {hasNothingToView && (
              <MessageWrapper>
                <ReceivedMessage content="No resolutions available." />
              </MessageWrapper>
            )}

            {/* Render content based on mode */}
            {isAgentMode ? (
              // Agent mode: Only chat messages (includes ModifiedFile messages)
              renderChatMessages("agent")
            ) : (
              // Non-agent mode: Both chat messages (LLM chunks, progress) AND local changes (file modifications)
              <>
                {renderChatMessages("non-agent")}
                {renderLocalChanges()}
              </>
            )}
          </MessageBox>
        </ChatbotContent>
      </Chatbot>
    </Page>
  );
};

export default ResolutionPage;
