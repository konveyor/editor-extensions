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
import { ResponseWrapper } from "./ResponseWrapper";
import "./resolutionsPage.css";
import { IncidentTableGroup } from "../IncidentTable/IncidentTableGroup";

const ResolutionPage: React.FC = () => {
  const [state, dispatch] = useExtensionState();
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
              <ResponseWrapper type="sent">
                Here is the scope of what I would like you to fix:
              </ResponseWrapper>
              <FlexItem className="chat-card-container">
                <ChatCard color="yellow">
                  <IncidentTableGroup
                    onIncidentSelect={handleIncidentClick}
                    incidents={solutionScope.incidents}
                    workspaceRoot={workspaceRoot}
                  />
                </ChatCard>
              </FlexItem>
              <ResponseWrapper type="sent">
                Please provide resolution for this issue.
              </ResponseWrapper>
            </Flex>
          )}

          <Flex
            direction={{ default: "column" }}
            grow={{ default: "grow" }}
            alignItems={{ default: "alignItemsFlexStart" }}
          >
            {hasNothingToView && (
              <ResponseWrapper type="received">No resolutions available.</ResponseWrapper>
            )}
            {isHistorySolution && (
              <ResponseWrapper type="received">Loaded last known resolution.</ResponseWrapper>
            )}
            {solutionMessages.map((msg) => (
              <ResponseWrapper key={msg} type="received">
                {msg}
              </ResponseWrapper>
            ))}
            {isFetchingSolution && <Spinner />}

            {hasResponse && (
              <ResponseWrapper type="received">
                <FileChanges
                  changes={getRemainingFiles()}
                  onFileClick={handleFileClick}
                  onApplyFix={handleAcceptClick}
                  onRejectChanges={handleRejectClick}
                />
              </ResponseWrapper>
            )}
            {hasEmptyResponse && !hasResponseWithErrors && (
              <ResponseWrapper type="received">
                Received response contains no resolutions.
              </ResponseWrapper>
            )}

            {hasResponseWithErrors && (
              <>
                <ResponseWrapper type="received">Response contains errors:</ResponseWrapper>
                <ResponseWrapper type="received">
                  <ul>
                    {resolution.encountered_errors.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                </ResponseWrapper>
              </>
            )}
            {isResolved && !isFetchingSolution && (
              <ResponseWrapper type="received">All resolutions have been applied.</ResponseWrapper>
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
