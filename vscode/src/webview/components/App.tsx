import React, { useState, useEffect } from "react";
import {
  Page,
  PageSection,
  Tabs,
  Tab,
  TabTitleText,
  TabContent,
  Title,
  EmptyState,
  EmptyStateIcon,
  EmptyStateBody,
  Button,
} from "@patternfly/react-core";
import { SearchIcon } from "@patternfly/react-icons";
import ViolationsList from "./ViolationsList";
import IncidentsPanel from "./IncidentsPanel";
import { RuleSet } from "../types";
import { vscode } from "../globals";
import { generateMockRuleSet } from "../mockData";

const App: React.FC = () => {
  const [ruleSet, setRuleSet] = useState<RuleSet | null>(null);
  const [selectedViolation, setSelectedViolation] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeTabKey, setActiveTabKey] = useState<string | number>(0);

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

  const handleViolationClick = (violationId: string) => {
    setSelectedViolation(violationId);
    setActiveTabKey(1); // Switch to Incidents tab
  };

  const startAnalysis = () => {
    setIsAnalyzing(true);
    // Simulate analysis delay
    setTimeout(() => {
      setRuleSet(generateMockRuleSet());
      setIsAnalyzing(false);
    }, 2000);
  };

  const handleTabClick = (
    event: React.MouseEvent<HTMLElement, MouseEvent>,
    tabIndex: string | number,
  ) => {
    setActiveTabKey(tabIndex);
  };

  return (
    <Page>
      <PageSection>
        <Title headingLevel="h1" size="lg">
          Konveyor Analysis
        </Title>
        {ruleSet && ruleSet.violations ? (
          <Tabs
            activeKey={activeTabKey}
            onSelect={handleTabClick}
            isBox={true}
            aria-label="Analysis tabs"
          >
            <Tab eventKey={0} title={<TabTitleText>Violations</TabTitleText>}>
              <TabContent id="violations-tab">
                <ViolationsList
                  violations={ruleSet.violations}
                  selectedViolation={selectedViolation}
                  onViolationClick={handleViolationClick}
                />
              </TabContent>
            </Tab>
            <Tab eventKey={1} title={<TabTitleText>Incidents</TabTitleText>}>
              <TabContent id="incidents-tab">
                <IncidentsPanel
                  violation={selectedViolation ? ruleSet.violations[selectedViolation] : null}
                />
              </TabContent>
            </Tab>
          </Tabs>
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
