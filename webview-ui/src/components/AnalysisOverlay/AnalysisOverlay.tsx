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
} from "@patternfly/react-core";
import { ArrowLeftIcon } from "@patternfly/react-icons";
import { Incident } from "@editor-extensions/shared";
import ProgressIndicator from "../ProgressIndicator";
import ViolationIncidentsList from "../ViolationIncidentsList";
import { ViolationsCount } from "../ViolationsCount/ViolationsCount";
import spacing from "@patternfly/react-styles/css/utilities/Spacing/spacing";

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

  return (
    <div className="analysis-overlay">
      <div className="analysis-header">
        <Button variant="plain" onClick={onClose} className="back-button">
          <ArrowLeftIcon />
          <span className={spacing.mlSm}>Back to Chat</span>
        </Button>
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
                        onGetSolution={(incidents) => dispatch(getSolution(incidents))}
                        expandedViolations={expandedViolations}
                        setExpandedViolations={setExpandedViolations}
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
