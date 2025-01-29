import React, { FC } from "react";
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
        <Flex
          direction={{
            default: "column",
          }}
        >
          {isTriggeredByUser && (
            <Flex
              direction={{
                default: "column",
              }}
              grow={{ default: "grow" }}
              alignItems={{ default: "alignItemsFlexEnd" }}
              justifyContent={{ default: "justifyContentFlexEnd" }}
            >
              <FlexItem>
                <YellowLabel>Here is the scope of what I would like you to fix:</YellowLabel>
              </FlexItem>
              <FlexItem className="chat-card-container">
                <ChatCard color="yellow">
                  <IncidentTableGroup
                    onIncidentSelect={handleIncidentClick}
                    violation={solutionScope?.violation}
                    incidents={solutionScope.incidents}
                    workspaceRoot={workspaceRoot}
                  />
                </ChatCard>
              </FlexItem>
              <FlexItem>
                <YellowLabel>Please provide resolution for this issue.</YellowLabel>
              </FlexItem>
            </Flex>
          )}
          <Flex
            direction={{
              default: "column",
            }}
            grow={{ default: "grow" }}
            alignItems={{ default: "alignItemsFlexStart" }}
          >
            {hasNothingToView && (
              <FlexItem>
                <Label color="blue">No resolutions available.</Label>
              </FlexItem>
            )}
            {isHistorySolution && (
              <FlexItem>
                <Label color="blue">Loaded last known resolution.</Label>
              </FlexItem>
            )}
            {solutionMessages.map((msg) => (
              <FlexItem key={msg}>
                <Label color="blue">{msg}</Label>
              </FlexItem>
            ))}
            {isFetchingSolution && <Spinner />}

            {hasResponse && (
              <FlexItem>
                <ChatCard color="blue">
                  <FileChanges
                    changes={getRemainingFiles()}
                    onFileClick={handleFileClick}
                    onApplyFix={handleAcceptClick}
                    onRejectChanges={handleRejectClick}
                  />
                </ChatCard>
              </FlexItem>
            )}
            {hasEmptyResponse && !hasResponseWithErrors && (
              <FlexItem>
                <Label color="blue">Received response contains no resolutions.</Label>
              </FlexItem>
            )}

            {hasResponseWithErrors && (
              <>
                <FlexItem>
                  <Label color="blue">Response contains errors:</Label>
                </FlexItem>
                <FlexItem>
                  <ChatCard color="blue">
                    <ul>
                      {resolution.encountered_errors.map((error, index) => (
                        <li key={index}>{error}</li>
                      ))}
                    </ul>
                  </ChatCard>
                </FlexItem>
              </>
            )}
            {isResolved && !isFetchingSolution && (
              <FlexItem>
                <Label color="blue">All resolutions have been applied.</Label>
              </FlexItem>
            )}
          </Flex>
        </Flex>
      </PageSection>
    </Page>
  );
};

const ChatCard: FC<{ color: "blue" | "yellow"; children: JSX.Element }> = ({ children, color }) => (
  <Card className={color === "blue" ? "pf-m-blue" : "pf-m-yellow"}>
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
