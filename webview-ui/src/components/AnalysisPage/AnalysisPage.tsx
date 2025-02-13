import "./styles.css";
import React, { useState } from "react";
import {
  Button,
  ButtonVariant,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  EmptyStateBody,
  Title,
  Alert,
  AlertActionCloseButton,
  AlertGroup,
  Spinner,
  Backdrop,
  Page,
  PageSection,
  Stack,
  StackItem,
  Flex,
  FlexItem,
  PageSidebar,
  PageSidebarBody,
  Masthead,
  MastheadMain,
  MastheadToggle,
  MastheadContent,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from "@patternfly/react-core";

import ProgressIndicator from "../ProgressIndicator";
import ViolationIncidentsList from "../ViolationIncidentsList";
import { Incident } from "@editor-extensions/shared";
import { openFile, startServer, runAnalysis, stopServer } from "../../hooks/actions";
import { ServerStatusToggle } from "../ServerStatusToggle/ServerStatusToggle";
import { ViolationsCount } from "../ViolationsCount/ViolationsCount";
import { useViolations } from "../..//hooks/useViolations";
import { useExtensionStateContext } from "../../context/ExtensionStateContext";

const AnalysisPage: React.FC = () => {
  const { state, dispatch } = useExtensionStateContext();

  const {
    isAnalyzing,
    isStartingServer,
    isInitializingServer,
    isFetchingSolution: isWaitingForSolution,
    ruleSets: analysisResults,
    enhancedIncidents,
  } = state;
  const serverRunning = state.serverState === "running";

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [focusedIncident, setFocusedIncident] = useState<Incident | null>(null);
  const [expandedViolations, setExpandedViolations] = useState<Set<string>>(new Set());

  const handleIncidentSelect = (incident: Incident) => {
    setFocusedIncident(incident);
    dispatch(openFile(incident.uri, incident.lineNumber ?? 0));
  };

  const runAnalysisRequest = () => dispatch(runAnalysis());

  const handleServerToggle = () => {
    dispatch(serverRunning ? stopServer() : startServer());
  };

  const violations = useViolations(analysisResults);

  const hasViolations = violations.length > 0;
  const hasAnalysisResults = analysisResults !== undefined;

  return (
    <Page
      sidebar={
        <PageSidebar isSidebarOpen={false}>
          <PageSidebarBody />
        </PageSidebar>
      }
      masthead={
        <Masthead>
          <MastheadMain>
            <MastheadToggle>
              <Button
                variant={ButtonVariant.primary}
                onClick={runAnalysisRequest}
                isLoading={isAnalyzing}
                isDisabled={
                  isAnalyzing || isStartingServer || !serverRunning || isWaitingForSolution
                }
              >
                {isAnalyzing ? "Analyzing..." : "Run Analysis"}
              </Button>
            </MastheadToggle>
          </MastheadMain>

          <MastheadContent>
            <Toolbar>
              <ToolbarContent>
                <ToolbarGroup variant="action-group-plain" align={{ default: "alignEnd" }}>
                  <ToolbarItem>
                    <ServerStatusToggle
                      isRunning={serverRunning}
                      isStarting={isStartingServer}
                      isInitializing={isInitializingServer}
                      onToggle={handleServerToggle}
                    />
                  </ToolbarItem>
                </ToolbarGroup>
              </ToolbarContent>
            </Toolbar>
          </MastheadContent>
        </Masthead>
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
                    enhancedIncidents={enhancedIncidents}
                    focusedIncident={focusedIncident}
                    onIncidentSelect={handleIncidentSelect}
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
  );
};

export default AnalysisPage;
