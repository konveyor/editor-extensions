import React, { FC } from "react";
import {
  Card,
  CardBody,
  Flex,
  FlexItem,
  Page,
  PageSection,
  PageSidebar,
  PageSidebarBody,
  Spinner,
  Title,
} from "@patternfly/react-core";
import { FileChanges } from "./FileChanges";
import { Incident, LocalChange } from "@editor-extensions/shared";
import { useExtensionState } from "../../hooks/useExtensionState";
import { applyFile, discardFile, openFile, viewFix } from "../../hooks/actions";
import "./resolutionsPage.css";
import { IncidentTableGroup } from "../IncidentTable/IncidentTableGroup";
import { SentMessage } from "./SentMessage";
import { ReceivedMessage } from "./ReceivedMessage";
import { ChatMessageComponent } from "./ChatMessageComponent";

const ResolutionPage: React.FC = () => {
  const [state, dispatch] = useExtensionState();
  const {
    localChanges,
    isFetchingSolution,
    solutionData: resolution,
    solutionScope,
    chatMessages,
    solutionState,
    workspaceRoot,
  } = state;

  const getRemainingFiles = () => {
    if (!resolution) {
      return [];
    }
    return localChanges.filter(({ state }) => state === "pending");
  };
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
  const handleIncidentClick = (incident: Incident) => {
    dispatch(openFile(incident.uri, incident.lineNumber ?? 0));
  };

  return (
    <Page
      sidebar={
        <PageSidebar isSidebarOpen={false}>
          <PageSidebarBody />
        </PageSidebar>
      }
    >
      <PageSection>
        <Flex>
          <FlexItem>
            <Title headingLevel="h1" size="2xl">
              Kai Results
            </Title>
          </FlexItem>
        </Flex>
      </PageSection>

      <PageSection>
        <Flex direction={{ default: "column" }} className="chat-container">
          {isTriggeredByUser && (
            <Flex
              direction={{ default: "column" }}
              grow={{ default: "grow" }}
              alignItems={{ default: "alignItemsFlexEnd" }}
            >
              <SentMessage>Here is the scope of what I would like you to fix:</SentMessage>
              <FlexItem className="chat-card-container">
                <ChatCard color="yellow">
                  <IncidentTableGroup
                    onIncidentSelect={handleIncidentClick}
                    incidents={solutionScope.incidents}
                    workspaceRoot={workspaceRoot}
                  />
                </ChatCard>
              </FlexItem>
              <SentMessage>Please provide resolution for this issue.</SentMessage>
            </Flex>
          )}

          <Flex
            direction={{ default: "column" }}
            grow={{ default: "grow" }}
            alignItems={{ default: "alignItemsFlexStart" }}
          >
            {hasNothingToView && <ReceivedMessage>No resolutions available.</ReceivedMessage>}
            {isHistorySolution && <ReceivedMessage>Loaded last known resolution.</ReceivedMessage>}

            {chatMessages.map((msg) => (
              <ReceivedMessage key={msg.messageToken}>
                <ChatMessageComponent message={msg} />
              </ReceivedMessage>
            ))}

            {isFetchingSolution && <Spinner />}

            {hasResponse && (
              <ReceivedMessage>
                <FileChanges
                  changes={getRemainingFiles()}
                  onFileClick={handleFileClick}
                  onApplyFix={handleAcceptClick}
                  onRejectChanges={handleRejectClick}
                />
              </ReceivedMessage>
            )}
            {hasEmptyResponse && !hasResponseWithErrors && (
              <ReceivedMessage>Received response contains no resolutions.</ReceivedMessage>
            )}
            {hasResponseWithErrors && (
              <>
                <ReceivedMessage>Response contains errors:</ReceivedMessage>
                <ReceivedMessage>
                  <ul>
                    {resolution.encountered_errors.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                </ReceivedMessage>
              </>
            )}

            {isResolved && !isFetchingSolution && (
              <ReceivedMessage>All resolutions have been applied.</ReceivedMessage>
            )}
          </Flex>
        </Flex>
      </PageSection>
    </Page>
  );
};

const ChatCard: FC<{ color: "blue" | "yellow"; children: JSX.Element }> = ({ children, color }) => (
  <Card className={`chat-bubble pf-m-${color}`}>
    <CardBody>{children}</CardBody>
  </Card>
);

export default ResolutionPage;
