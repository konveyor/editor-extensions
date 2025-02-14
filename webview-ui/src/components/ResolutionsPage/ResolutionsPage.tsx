import "./resolutionsPage.css";
import React, { FC } from "react";
import { Card, CardBody, Grid, GridItem, Page, PageSection, Title } from "@patternfly/react-core";
import { FileChanges } from "./FileChanges";
import { Incident, LocalChange } from "@editor-extensions/shared";
import { applyFile, discardFile, openFile, viewFix } from "../../hooks/actions";
import { IncidentTableGroup } from "../IncidentTable/IncidentTableGroup";
import { SentMessage } from "./SentMessage";
import { ReceivedMessage } from "./ReceivedMessage";
import { useExtensionStateContext } from "../../context/ExtensionStateContext";

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

  const getRemainingFiles = () => {
    if (!resolution) {
      return [];
    }
    return localChanges.filter(({ state }) => state === "pending");
  };
  const isTriggeredByUser = !!solutionScope?.incidents?.length;
  const isHistorySolution = !isTriggeredByUser && !!localChanges.length;
  const configuredEffort = solutionScope?.effort;

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
    <Page>
      <PageSection>
        <Title headingLevel="h1" size="2xl">
          Kai Results
        </Title>
      </PageSection>
      <PageSection isWidthLimited>
        <Grid hasGutter>
          <GridItem span={12} sm={12} md={12} lg={12} xl={12}>
            {isTriggeredByUser && (
              <>
                <SentMessage mainContent="Here is the scope of what I would like you to fix:">
                  <ChatCard color="yellow">
                    <IncidentTableGroup
                      onIncidentSelect={handleIncidentClick}
                      incidents={solutionScope.incidents}
                    />
                  </ChatCard>
                </SentMessage>
                <SentMessage mainContent="Please provide resolution for this issue."></SentMessage>
              </>
            )}
            {hasNothingToView && <ReceivedMessage mainContent="No resolutions available." />}
            {isHistorySolution && <ReceivedMessage mainContent="Loaded last known resolution." />}
            {chatMessages.map((msg) => (
              <ReceivedMessage
                key={msg.value.message as string}
                mainContent={msg.value.message as string}
              />
            ))}
            {isFetchingSolution && <ReceivedMessage isLoading />}
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
                <ReceivedMessage mainContent="Response contains errors">
                  <ul>
                    {resolution.encountered_errors.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                </ReceivedMessage>
              </>
            )}
            {isResolved && !isFetchingSolution && (
              <ReceivedMessage mainContent="All resolutions have been applied"></ReceivedMessage>
            )}
          </GridItem>
        </Grid>
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
