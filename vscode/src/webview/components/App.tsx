import React, { useState, useEffect } from "react";
import {
  Page,
  PageSection,
  Title,
  EmptyState,
  EmptyStateIcon,
  EmptyStateBody,
  Button,
} from "@patternfly/react-core";
import { SearchIcon } from "@patternfly/react-icons";
import { vscode } from "../globals";
import { generateMockRuleSet } from "../mockData";
import { RuleSet } from "../types";
import ViolationIncidentsList from "./ViolationIncidentsList";

const App: React.FC = () => {
  const [ruleSet, setRuleSet] = useState<RuleSet | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    vscode.postMessage({ command: "requestAnalysisData" });

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.command) {
        case "analysisData":
          if (message.data) {
            setRuleSet(message.data);
          }
          break;
      }
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  const startAnalysis = () => {
    setIsAnalyzing(true);
    // Simulate analysis delay
    setTimeout(() => {
      setRuleSet(generateMockRuleSet());
      setIsAnalyzing(false);
    }, 2000);
  };

  return (
    <Page>
      <PageSection>
        <Title headingLevel="h1" size="lg">
          Konveyor Analysis
        </Title>
        {ruleSet && ruleSet.violations ? (
          <ViolationIncidentsList ruleSet={ruleSet} />
        ) : (
          <EmptyState>
            <EmptyStateIcon icon={SearchIcon} />
            <Title headingLevel="h2" size="lg">
              No Analysis Results
            </Title>
            <EmptyStateBody>Run an analysis to see results here.</EmptyStateBody>
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
