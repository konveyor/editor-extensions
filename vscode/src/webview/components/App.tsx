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
  Flex,
  FlexItem,
  Stack,
  StackItem,
} from "@patternfly/react-core";
import { SearchIcon } from "@patternfly/react-icons";
import { RuleSet } from "../types";
import { vscode } from "../globals";
import ViolationIncidentsList from "./ViolationIncidentsList";

const App: React.FC = () => {
  const [analysisResults, setAnalysisResults] = useState<RuleSet[] | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.type) {
        case "analysisData":
          if (message.data) {
            // setRuleSet(message.data);
          }
          break;
        case "analysisStarted":
          setIsAnalyzing(true);
          setAnalysisMessage("Analysis started...");
          setErrorMessage(null);
          break;
        case "analysisComplete":
          setIsAnalyzing(false);
          setAnalysisMessage("");
          if (message.data) {
            console.log("Setting analysis results:", message.data);
            setAnalysisResults(message.data);
          }
          break;
        case "analysisFailed":
          setIsAnalyzing(false);
          setAnalysisMessage("");
          setErrorMessage(`Analysis failed: ${message.message}`);
          break;
      }
    };

    window.addEventListener("message", handleMessage);

    // Request initial analysis data
    vscode.postMessage({ command: "requestAnalysisData" });

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  const startAnalysis = () => {
    vscode.postMessage({ command: "startAnalysis" });
  };

  return (
    <Page>
      <PageSection>
        <Stack hasGutter>
          <StackItem>
            <Flex justifyContent={{ default: "justifyContentCenter" }}>
              <FlexItem>
                <Title headingLevel="h1" size="lg">
                  Konveyor Analysis
                </Title>
              </FlexItem>
            </Flex>
          </StackItem>
          <StackItem>
            <Flex justifyContent={{ default: "justifyContentCenter" }}>
              <FlexItem>
                <Button
                  variant="primary"
                  onClick={startAnalysis}
                  isLoading={isAnalyzing}
                  isDisabled={isAnalyzing}
                >
                  {isAnalyzing ? "Analyzing..." : "Run Analysis"}
                </Button>
              </FlexItem>
            </Flex>
          </StackItem>
          {errorMessage && (
            <StackItem>
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
            </StackItem>
          )}
          <StackItem>
            {analysisResults ? (
              <ViolationIncidentsList ruleSets={analysisResults} />
            ) : (
              <EmptyState>
                <EmptyStateIcon icon={SearchIcon} />
                <Title headingLevel="h2" size="lg">
                  No Analysis Results
                </Title>
                <EmptyStateBody>
                  {analysisMessage || "Run an analysis to see results here."}
                </EmptyStateBody>
              </EmptyState>
            )}
          </StackItem>
        </Stack>
      </PageSection>
    </Page>
  );
};

export default App;
