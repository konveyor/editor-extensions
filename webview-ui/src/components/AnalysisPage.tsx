import React, { useState, useMemo } from "react";
import {
  Button,
  ButtonVariant,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Content,
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
} from "@patternfly/react-core";
import spacing from "@patternfly/react-styles/css/utilities/Spacing/spacing";

import ProgressIndicator from "./ProgressIndicator";
import ViolationIncidentsList from "./ViolationIncidentsList";
import { Incident } from "@editor-extensions/shared";
import { useExtensionState } from "../hooks/useExtensionState";
import { cancelSolution, getSolution, openFile, startServer, runAnalysis } from "../hooks/actions";
import { ServerStatusToggle } from "./ServerStatusToggle/ServerStatusToggle";

const AnalysisPage: React.FC = () => {
  const [state, dispatch] = useExtensionState();
  const {
    isAnalyzing,
    isStartingServer,
    isFetchingSolution: isWaitingForSolution,
    ruleSets: analysisResults,
  } = state;
  const serverRunning = state.serverState === "running";

  const [analysisMessage, setAnalysisMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [focusedIncident, setFocusedIncident] = useState<Incident | null>(null);
  const [expandedViolations, setExpandedViolations] = useState<Set<string>>(new Set());

  const handleIncidentSelect = (incident: Incident) => {
    setFocusedIncident(incident);
    dispatch(openFile(incident.uri, incident.lineNumber));
  };

  const runAnalysisRequest = () => dispatch(runAnalysis());

  const cancelSolutionRequest = () => dispatch(cancelSolution());

  const handleServerToggle = () => {
    if (!serverRunning) {
      dispatch(startServer());
    }
    // Add stopServer action when available
  };

  const violations = useMemo(() => {
    if (!analysisResults?.length) {
      return [];
    }
    return analysisResults.flatMap((ruleSet) =>
      Object.entries(ruleSet.violations || {}).map(([id, violation]) => ({
        id,
        ...violation,
      })),
    );
  }, [analysisResults]);

  const hasViolations = violations.length > 0;
  const hasAnalysisResults = analysisResults !== undefined;

  return (
    <Page>
      <ServerStatusToggle
        isRunning={serverRunning}
        isStarting={isStartingServer}
        onToggle={handleServerToggle}
      />

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
                <CardTitle>Analysis Actions</CardTitle>
              </CardHeader>
              <CardBody>
                <Stack hasGutter>
                  <StackItem>
                    <Content>
                      {hasAnalysisResults
                        ? "Previous analysis results are available. You can run a new analysis at any time."
                        : "No previous analysis results found. Run an analysis to get started."}
                    </Content>
                  </StackItem>
                  <StackItem>
                    <Button
                      variant={ButtonVariant.primary}
                      onClick={runAnalysisRequest}
                      isLoading={isAnalyzing}
                      isDisabled={isAnalyzing || isStartingServer || !serverRunning}
                    >
                      {isAnalyzing ? "Analyzing..." : "Run Analysis"}
                    </Button>
                  </StackItem>
                </Stack>
              </CardBody>
            </Card>
          </StackItem>

          <StackItem>
            <Card>
              <CardHeader>
                <CardTitle>Analysis Results</CardTitle>
              </CardHeader>
              <CardBody>
                {isAnalyzing && <ProgressIndicator progress={50} />}

                {!isAnalyzing && !hasViolations && (
                  <EmptyState variant="sm">
                    <Title headingLevel="h2" size="md">
                      {hasAnalysisResults ? "No Violations Found" : "No Analysis Results"}
                    </Title>
                    <EmptyStateBody>
                      {hasAnalysisResults
                        ? "Great job! Your analysis didn't find any violations."
                        : analysisMessage || "Run an analysis to see results here."}
                    </EmptyStateBody>
                  </EmptyState>
                )}

                {hasViolations && !isAnalyzing && (
                  <ViolationIncidentsList
                    isRunning={serverRunning}
                    violations={violations}
                    focusedIncident={focusedIncident}
                    onIncidentSelect={handleIncidentSelect}
                    onGetSolution={(incident, violation) =>
                      dispatch(getSolution(incident, violation))
                    }
                    onGetAllSolutions={() => {}}
                    compact={false}
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
            <Button
              variant={ButtonVariant.link}
              onClick={cancelSolutionRequest}
              className={spacing.mtMd}
            >
              Cancel
            </Button>
          </div>
        </Backdrop>
      )}
    </Page>
  );
};

export default AnalysisPage;
