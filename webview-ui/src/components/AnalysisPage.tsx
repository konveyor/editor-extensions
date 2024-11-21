// AnalysisPage.tsx
import React, { useState, useMemo, useEffect } from "react";
import {
  Button,
  ButtonVariant,
  EmptyState,
  EmptyStateBody,
  Title,
  Alert,
  AlertActionCloseButton,
  AlertGroup,
  Spinner,
  Backdrop,
} from "@patternfly/react-core";
import spacing from "@patternfly/react-styles/css/utilities/Spacing/spacing";

import { vscode } from "../utils/vscode";
import ProgressIndicator from "./ProgressIndicator";
import ViolationIncidentsList from "./ViolationIncidentsList";
import { Incident, RuleSet } from "@editor-extensions/shared";
import { useVscodeMessages } from "../hooks/useVscodeMessages";
import { sendVscodeMessage } from "../utils/vscodeMessaging";

const AnalysisPage: React.FC = () => {
  const [analysisResults, setAnalysisResults] = useState<RuleSet[] | null>();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [focusedIncident, setFocusedIncident] = useState<Incident | null>(null);
  const [expandedViolations, setExpandedViolations] = useState<Set<string>>(new Set());
  const [isWaitingForSolution, setIsWaitingForSolution] = useState(false);
  const [serverRunning, setServerRunning] = useState(false);

  const handleIncidentSelect = (incident: Incident) => {
    setFocusedIncident(incident);
    vscode.postMessage({
      command: "openFile",
      file: incident.uri,
      line: incident.lineNumber,
    });
  };

  // Function to fetch server status
  const fetchServerStatus = () => {
    vscode.postMessage({ command: "checkServerStatus" });
  };

  // Effect hook to check server status on component mount and periodically
  useEffect(() => {
    fetchServerStatus();
    const interval = setInterval(fetchServerStatus, 5000); // Check every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const messageHandler = (message: any) => {
    switch (message.type) {
      case "serverStatus":
        setServerRunning(message.isRunning);
        break;

      case "loadStoredAnalysis": {
        const storedAnalysisResults = message.data;
        setAnalysisResults(
          storedAnalysisResults && storedAnalysisResults.length ? storedAnalysisResults : null,
        );
        break;
      }
      case "solutionConfirmation": {
        if (message.data) {
          const { solution, confirmed } = message.data;
          if (confirmed) {
            setErrorMessage(null);
            setIsWaitingForSolution(false);
            // sendVscodeMessage("applySolution", { solution });
          }
        }
        break;
      }
      case "analysisStarted":
        setIsAnalyzing(true);
        setAnalysisMessage("Analysis started...");
        setErrorMessage(null);
        break;
      case "analysisComplete":
        setIsAnalyzing(false);
        setAnalysisMessage("");
        setAnalysisResults(message.data || null);
        break;
      case "analysisFailed":
        setIsAnalyzing(false);
        setAnalysisMessage("");
        setErrorMessage(`Analysis failed: ${message.message}`);
        break;
    }
  };

  useVscodeMessages(messageHandler); // Use the custom hook for message handling

  const startAnalysis = () => {
    vscode.postMessage({ command: "startAnalysis" });
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

  return (
    <>
      {serverRunning && (
        <div style={{ display: "flex", justifyContent: "center" }}>
          {" "}
          {/* Add this line */}
          <Button
            variant={ButtonVariant.primary}
            onClick={startAnalysis}
            isLoading={isAnalyzing}
            isDisabled={!serverRunning || isAnalyzing}
            className={spacing.mtXl}
          >
            {isAnalyzing ? "Analyzing..." : "Run Analysis"}
          </Button>
        </div>
      )}

      {errorMessage && (
        <AlertGroup isToast>
          <Alert
            variant="danger"
            title={errorMessage}
            actionClose={
              <AlertActionCloseButton title={errorMessage} onClose={() => setErrorMessage(null)} />
            }
          />
        </AlertGroup>
      )}

      <div>
        {isAnalyzing ? (
          <ProgressIndicator progress={50} />
        ) : hasViolations ? (
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
        ) : !serverRunning ? (
          <EmptyState>
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
        ) : (
          <EmptyState>
            <Title headingLevel="h2" size="lg">
              {analysisResults?.length ? "No Violations Found" : "No Analysis Results"}
            </Title>
            <EmptyStateBody>
              {analysisResults?.length
                ? "Great job! Your analysis didn't find any violations."
                : analysisMessage || "Run an analysis to see results here."}
            </EmptyStateBody>
          </EmptyState>
        )}
      </div>

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
    </>
  );
};

export default AnalysisPage;
