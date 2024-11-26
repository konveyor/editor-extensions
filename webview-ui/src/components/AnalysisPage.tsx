import React, { useState, useMemo, useEffect } from "react";
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

import { vscode } from "../utils/vscode";
import ProgressIndicator from "./ProgressIndicator";
import ViolationIncidentsList from "./ViolationIncidentsList";
import { Incident, RuleSet } from "@editor-extensions/shared";
import { useVscodeMessages } from "../hooks/useVscodeMessages";
import { sendVscodeMessage } from "../utils/vscodeMessaging";
import { WarningTriangleIcon } from "@patternfly/react-icons";

const AnalysisPage: React.FC = () => {
  const [analysisResults, setAnalysisResults] = useState<RuleSet[] | undefined>(undefined);
  const [analysisMessage, setAnalysisMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [focusedIncident, setFocusedIncident] = useState<Incident | null>(null);
  const [expandedViolations, setExpandedViolations] = useState<Set<string>>(new Set());
  const [serverRunning, setServerRunning] = useState(false);
  const [isStartingServer, setIsStartingServer] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isWaitingForSolution, setIsWaitingForSolution] = useState(false);

  const handleIncidentSelect = (incident: Incident) => {
    setFocusedIncident(incident);
    vscode.postMessage({
      command: "openFile",
      file: incident.uri,
      line: incident.lineNumber,
    });
  };

  const fetchServerStatus = () => {
    vscode.postMessage({ command: "checkServerStatus" });
  };

  useEffect(() => {
    fetchServerStatus();
    const interval = setInterval(fetchServerStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const messageHandler = (message: any) => {
    console.log("Received message from VS Code:", message);

    switch (message.type) {
      case "onDidChangeData": {
        const { isAnalyzing, isFetchingSolution, errorMessage, ruleSets, isStartingServer } =
          message.value;
        setIsAnalyzing(isAnalyzing);
        setIsWaitingForSolution(isFetchingSolution);
        setIsStartingServer(isStartingServer);
        setErrorMessage(errorMessage);
        setAnalysisResults(ruleSets);
        break;
      }
      case "serverStatus":
        setServerRunning(message.isRunning);
        break;
    }
  };

  useVscodeMessages(messageHandler);

  const startAnalysis = () => {
    vscode.postMessage({ command: "startAnalysis" });
  };

  const cancelSolutionRequest = () => {
    vscode.postMessage({ command: "cancelSolution" });
    setIsWaitingForSolution(false);
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

  if (isStartingServer) {
    return (
      <Backdrop>
        <div style={{ textAlign: "center", paddingTop: "15rem" }}>
          <Spinner size="lg" />
          <Title headingLevel="h2" size="lg">
            Starting server...
          </Title>
        </div>
      </Backdrop>
    );
  }

  if (!serverRunning) {
    return (
      <Page>
        <PageSection>
          <EmptyState icon={WarningTriangleIcon}>
            <Title headingLevel="h2" size="lg">
              Server Not Running
            </Title>
            <EmptyStateBody>
              The server is not running. Please start the server to run an analysis.
            </EmptyStateBody>
            <Button
              className={spacing.mtMd}
              variant={ButtonVariant.primary}
              onClick={() => sendVscodeMessage("startServer", {})}
            >
              Start Server
            </Button>
          </EmptyState>
        </PageSection>
      </Page>
    );
  }

  return (
    <Page>
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
                      onClick={startAnalysis}
                      isLoading={isAnalyzing}
                      isDisabled={isAnalyzing || isStartingServer}
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
                    violations={violations}
                    focusedIncident={focusedIncident}
                    onIncidentSelect={handleIncidentSelect}
                    onGetSolution={(incident, violation) => {
                      setIsWaitingForSolution(true);
                      vscode.postMessage({
                        command: "getSolution",
                        incident,
                        violation,
                      });
                    }}
                    onGetAllSolutions={(selectedViolations) => {
                      setIsWaitingForSolution(true);
                      vscode.postMessage({
                        command: "getAllSolutions",
                        selectedViolations,
                      });
                    }}
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
