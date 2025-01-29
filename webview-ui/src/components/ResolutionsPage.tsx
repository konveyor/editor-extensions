import React, { FC, useEffect, useRef } from "react";
import {
  Card,
  CardBody,
  Flex,
  FlexItem,
  Label,
  Page,
  PageSection,
  PageSidebar,
  PageSidebarBody,
  Spinner,
  Title,
} from "@patternfly/react-core";
import { FileChanges } from "./FileChanges";
import { Incident, LocalChange } from "@editor-extensions/shared";
import { useExtensionState } from "../hooks/useExtensionState";
import { applyFile, discardFile, openFile, viewFix } from "../hooks/actions";
import { IncidentTableGroup } from "./IncidentTable";
import "./resolutionsPage.css";

const ResolutionPage: React.FC = () => {
  const [state, dispatch] = useExtensionState();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const {
    localChanges,
    isFetchingSolution,
    solutionData: resolution,
    solutionScope,
    solutionMessages,
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
  const isResolved = localChanges.length !== 0 && getRemainingFiles().length === 0;
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
        <Title headingLevel="h1" size="2xl">
          Kai Results
        </Title>
      </PageSection>

      <PageSection className="chat-page-section">
        <div className="chat-container">
          <div className="messages-container">
            {isTriggeredByUser && (
              <div className="message-group user">
                <YellowLabel>Here is the scope of what I would like you to fix:</YellowLabel>
                <div className="chat-card-container">
                  <ChatCard color="yellow">
                    <IncidentTableGroup
                      onIncidentSelect={handleIncidentClick}
                      violation={solutionScope?.violation}
                      incidents={solutionScope.incidents}
                      workspaceRoot={workspaceRoot}
                    />
                  </ChatCard>
                </div>
                <YellowLabel>Please provide resolution for this issue.</YellowLabel>
              </div>
            )}

            <div className="message-group bot">
              {hasNothingToView && <Label color="blue">No resolutions available.</Label>}

              {isHistorySolution && <Label color="blue">Loaded last known resolution.</Label>}

              {solutionMessages.map((msg) => (
                <Label key={msg} color="blue">
                  {msg}
                </Label>
              ))}

              {hasResponse && (
                <div className="chat-card-container">
                  <ChatCard color="blue">
                    <FileChanges
                      changes={getRemainingFiles()}
                      onFileClick={handleFileClick}
                      onApplyFix={handleAcceptClick}
                      onRejectChanges={handleRejectClick}
                    />
                  </ChatCard>
                </div>
              )}

              {hasEmptyResponse && !hasResponseWithErrors && (
                <Label color="blue">Received response contains no resolutions.</Label>
              )}

              {hasResponseWithErrors && (
                <>
                  <Label color="blue">Response contains errors:</Label>
                  <div className="chat-card-container">
                    <ChatCard color="blue">
                      <ul>
                        {resolution.encountered_errors.map((error, index) => (
                          <li key={index}>{error}</li>
                        ))}
                      </ul>
                    </ChatCard>
                  </div>
                </>
              )}

              {isResolved && !isFetchingSolution && (
                <Label color="blue">All resolutions have been applied.</Label>
              )}
            </div>

            <div ref={messagesEndRef} />
          </div>

          {isFetchingSolution && (
            <div className="loading-state">
              <Spinner size="sm" aria-label="Loading resolution" />
              <span>Generating resolution...</span>
            </div>
          )}
        </div>
      </PageSection>
    </Page>
  );
};

const ChatCard: FC<{ color: "blue" | "yellow"; children: JSX.Element }> = ({ children, color }) => (
  <Card className={`pf-v6-c-card pf-m-${color}`}>
    <CardBody>{children}</CardBody>
  </Card>
);

const YellowLabel: FC<{ children: JSX.Element | string }> = ({ children }) => (
  <>
    <Label className="resolutions-show-in-light" color="yellow">
      {children}
    </Label>
    <Label className="resolutions-show-in-dark" variant="outline">
      {children}
    </Label>
  </>
);

export default ResolutionPage;
