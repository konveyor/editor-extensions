import React, { useState, useEffect } from "react";
import {
  Page,
  PageSection,
  Title,
  EmptyState,
  EmptyStateIcon,
  EmptyStateBody,
  Button,
  Alert,
  AlertActionCloseButton,
  AlertGroup,
} from "@patternfly/react-core";
import { SearchIcon } from "@patternfly/react-icons";
import { vscode } from "../globals";
import { RuleSet } from "../types";
import ViolationIncidentsList from "./ViolationIncidentsList";

const App: React.FC = () => {
  const [ruleSet, setRuleSet] = useState<RuleSet | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    vscode.postMessage({ command: "requestAnalysisData" });

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.type) {
        case "analysisData":
          if (message.data) {
            setRuleSet(message.data);
          }
          break;
        case "analysisStarted":
          setIsAnalyzing(true);
          setAnalysisMessage("Analysis started...");
          setErrorMessage(null);
          break;
        case "analysisComplete":
          setIsAnalyzing(false);
          setAnalysisMessage(`Analysis complete: ${message.message}`);
          setErrorMessage(null);
          // Request updated analysis data
          vscode.postMessage({ command: "requestAnalysisData" });
          break;
        case "analysisFailed":
          setIsAnalyzing(false);
          setAnalysisMessage("");
          setErrorMessage(`Analysis failed: ${message.message}`);
          break;
      }
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  const startAnalysis = () => {
    vscode.postMessage({ command: "showFilePicker" });
  };

  return (
    <Page>
      <PageSection>
        <Title headingLevel="h1" size="lg">
          Konveyor Analysis
        </Title>
        {errorMessage && (
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
        )}
        {ruleSet && ruleSet.violations ? (
          <>
            <Button
              variant="primary"
              onClick={startAnalysis}
              isLoading={isAnalyzing}
              isDisabled={isAnalyzing}
            >
              {isAnalyzing ? "Analyzing..." : "Run Analysis"}
            </Button>
            <ViolationIncidentsList ruleSet={ruleSet} />
          </>
        ) : (
          <EmptyState>
            <EmptyStateIcon icon={SearchIcon} />
            <Title headingLevel="h2" size="lg">
              No Analysis Results
            </Title>
            <EmptyStateBody>
              {analysisMessage || "Run an analysis to see results here."}
            </EmptyStateBody>
            <Button
              variant="primary"
              onClick={startAnalysis}
              isLoading={isAnalyzing}
              isDisabled={isAnalyzing}
            >
              {isAnalyzing ? "Analyzing..." : "Run Analysis"}
            </Button>
          </EmptyState>
        )}
      </PageSection>
    </Page>
  );
};

export default App;
