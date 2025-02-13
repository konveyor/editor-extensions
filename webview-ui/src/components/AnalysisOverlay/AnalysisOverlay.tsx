import "./analysisOverlay.css";
import React from "react";
import {
  Page,
  PageSection,
  PageSidebar,
  PageSidebarBody,
  Button,
  EmptyState,
  EmptyStateBody,
  Title,
  Alert,
  AlertActionCloseButton,
  AlertGroup,
  Backdrop,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Flex,
  FlexItem,
  Stack,
  StackItem,
  Spinner,
  Tooltip,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
} from "@patternfly/react-core";
import {
  ArrowLeftIcon,
  WrenchIcon,
  LightbulbIcon,
  BoltIcon,
  CogIcon,
} from "@patternfly/react-icons";
import { Incident } from "@editor-extensions/shared";
import ProgressIndicator from "../ProgressIndicator";
import ViolationIncidentsList from "../ViolationIncidentsList";
import { ViolationsCount } from "../ViolationsCount/ViolationsCount";
import spacing from "@patternfly/react-styles/css/utilities/Spacing/spacing";

type EffortLevel = "low" | "medium" | "high";

interface AnalysisOverlayProps {
  onClose: () => void;
  errorMessage: string | null;
  setErrorMessage: (message: string | null) => void;
  isAnalyzing: boolean;
  isWaitingForSolution: boolean;
  violations: any[];
  hasAnalysisResults: boolean;
  workspaceRoot: string;
  serverRunning: boolean;
  enhancedIncidents: any[];
  focusedIncident: Incident | null;
  onIncidentSelect: (incident: Incident) => void;
  dispatch: any;
  getSolution: any;
  expandedViolations: Set<string>;
  setExpandedViolations: (violations: Set<string>) => void;
}

export const AnalysisOverlay: React.FC<AnalysisOverlayProps> = ({
  onClose,
  errorMessage,
  setErrorMessage,
  isAnalyzing,
  isWaitingForSolution,
  violations,
  hasAnalysisResults,
  workspaceRoot,
  serverRunning,
  enhancedIncidents,
  focusedIncident,
  onIncidentSelect,
  dispatch,
  getSolution,
  expandedViolations,
  setExpandedViolations,
}) => {
  const hasViolations = violations.length > 0;
  const [selectedIncidents, setSelectedIncidents] = React.useState<Set<string>>(new Set());
  const [effortLevel, setEffortLevel] = React.useState<EffortLevel>("medium");

  const handleGetSolution = () => {
    const selectedIncidentsList = enhancedIncidents.filter((incident) =>
      selectedIncidents.has(`${incident.uri}-${incident.lineNumber}`),
    );
    if (selectedIncidentsList.length > 0) {
      dispatch(getSolution(selectedIncidentsList, effortLevel));
      onClose();
    }
  };

  return (
    <div className="analysis-overlay">
      <div className="analysis-header">
        <Flex className="header-content">
          <FlexItem>
            <Button variant="plain" onClick={onClose} className="back-button">
              <ArrowLeftIcon />
              <span className={spacing.mlSm}>Back to Chat</span>
            </Button>
          </FlexItem>
          <FlexItem align={{ default: "alignRight" }}>
            <Flex>
              <FlexItem>
                <ToggleGroup aria-label="Solution effort level">
                  <ToggleGroupItem
                    // icon={<LightbulbIcon />}
                    text="Low effort"
                    buttonId="low"
                    isSelected={effortLevel === "low"}
                    onChange={() => setEffortLevel("low")}
                    isDisabled={
                      !hasViolations ||
                      isAnalyzing ||
                      selectedIncidents.size === 0 ||
                      isWaitingForSolution
                    }
                  />
                  <ToggleGroupItem
                    // icon={<BoltIcon />}
                    text="Medium effort"
                    buttonId="medium"
                    isSelected={effortLevel === "medium"}
                    onChange={() => setEffortLevel("medium")}
                    isDisabled={
                      !hasViolations ||
                      isAnalyzing ||
                      selectedIncidents.size === 0 ||
                      isWaitingForSolution
                    }
                  />
                  <ToggleGroupItem
                    icon={<BoltIcon />}
                    text="High effort"
                    buttonId="high"
                    isSelected={effortLevel === "high"}
                    onChange={() => setEffortLevel("high")}
                    isDisabled={
                      !hasViolations ||
                      isAnalyzing ||
                      selectedIncidents.size === 0 ||
                      isWaitingForSolution
                    }
                  />
                </ToggleGroup>
              </FlexItem>
              <FlexItem>
                <Button
                  variant="primary"
                  icon={<WrenchIcon />}
                  onClick={handleGetSolution}
                  isDisabled={
                    !hasViolations ||
                    isAnalyzing ||
                    selectedIncidents.size === 0 ||
                    isWaitingForSolution
                  }
                >
                  Get Solution {selectedIncidents.size > 0 && `(${selectedIncidents.size})`}
                </Button>
              </FlexItem>
            </Flex>
          </FlexItem>
        </Flex>
      </div>
      <div className="analysis-content">
        <Page
          sidebar={
            <PageSidebar isSidebarOpen={false}>
              <PageSidebarBody />
            </PageSidebar>
          }
        >
          {errorMessage && (
            <PageSection padding={{ default: "noPadding" }}>
              <AlertGroup isToast>
                <Alert
                  variant="danger"
                  title={errorMessage}
                  actionClose={
                    <AlertActionCloseButton
                      title={errorMessage}
                      onClose={() => setErrorMessage(null)}
                    />
                  }
                />
              </AlertGroup>
            </PageSection>
          )}

          <PageSection>
            <Stack hasGutter>
              <StackItem>
                <Card>
                  <CardHeader>
                    <Flex className="header-layout">
                      <FlexItem>
                        <CardTitle>Analysis Results</CardTitle>
                        <ViolationsCount
                          violationsCount={violations.length}
                          incidentsCount={violations.reduce(
                            (prev, curr) => curr.incidents.length + prev,
                            0,
                          )}
                        />
                      </FlexItem>
                      <>
                        <FlexItem></FlexItem>
                      </>
                    </Flex>
                  </CardHeader>
                  <CardBody>
                    {isAnalyzing && <ProgressIndicator progress={50} />}

                    {!isAnalyzing && !hasViolations && (
                      <EmptyState variant="sm">
                        <Title className="empty-state-analysis-results" headingLevel="h2" size="md">
                          {hasAnalysisResults ? "No Violations Found" : "No Analysis Results"}
                        </Title>
                        <EmptyStateBody>
                          {hasAnalysisResults
                            ? "Great job! Your analysis didn't find any violations."
                            : "Run an analysis to see results here."}
                        </EmptyStateBody>
                      </EmptyState>
                    )}

                    {hasViolations && !isAnalyzing && (
                      <ViolationIncidentsList
                        workspaceRoot={workspaceRoot}
                        isRunning={serverRunning}
                        enhancedIncidents={enhancedIncidents}
                        focusedIncident={focusedIncident}
                        onIncidentSelect={onIncidentSelect}
                        expandedViolations={expandedViolations}
                        setExpandedViolations={setExpandedViolations}
                        selectedIncidents={selectedIncidents}
                        setSelectedIncidents={setSelectedIncidents}
                      />
                    )}
                  </CardBody>
                </Card>
              </StackItem>
            </Stack>
          </PageSection>

          {isWaitingForSolution && (
            <Backdrop>
              <div style={{ textAlign: "center", paddingTop: "15rem" }}>
                <Spinner size="lg" />
                <Title headingLevel="h2" size="lg">
                  Waiting for solution confirmation...
                </Title>
              </div>
            </Backdrop>
          )}
        </Page>
      </div>
    </div>
  );
};
