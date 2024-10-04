import React, { useState, useEffect, useMemo } from "react";
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
  Wizard,
  Modal,
  ButtonVariant,
  WizardNav,
  WizardNavItem,
  WizardStep,
  WizardFooter,
  WizardBasicStep,
} from "@patternfly/react-core";
import { SearchIcon } from "@patternfly/react-icons";
import { vscode } from "../globals";
import { RuleSet } from "../types";
import ViolationIncidentsList from "./ViolationIncidentsList";
import { mockResults } from "../mockResults";

const App: React.FC = () => {
  const [analysisResults, setAnalysisResults] = useState<RuleSet[] | null>(
    mockResults as RuleSet[],
  );
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState(0);

  useEffect(() => {
    setAnalysisResults(mockResults as RuleSet[]);
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.type) {
        case "analysisData":
          if (message.data) {
            setAnalysisResults(message.data);
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

    vscode.postMessage({ command: "requestAnalysisData" });

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  const startAnalysis = () => {
    vscode.postMessage({ command: "startAnalysis" });
  };

  const startGuidedApproach = () => {
    setIsWizardOpen(true);
  };

  const closeWizard = () => {
    setIsWizardOpen(false);
  };

  const violations = useMemo(() => {
    if (!analysisResults?.length) {
      return [];
    }
    return analysisResults.flatMap((ruleSet) =>
      Object.entries(ruleSet.violations || {}).map(([id, violation]) => ({ id, ...violation })),
    );
  }, [analysisResults]);

  const hasViolations = violations.length > 0;
  const onNext = () => {
    setActiveStepIndex((prev) => Math.min(prev + 1, steps.length - 1));
  };

  const onBack = () => {
    setActiveStepIndex((prev) => Math.max(prev - 1, 0));
  };
  const steps: WizardBasicStep[] = useMemo(() => {
    return violations.map((violation, index) => ({
      index: index,
      id: `violation-step-${violation.id}`,
      name: `Violation ${index + 1}`,
      component: (
        <ViolationIncidentsList violations={[violation]} focusedIncident={violation.incidents[0]} />
      ),
    }));
  }, [violations]);

  const CustomFooter = (
    <WizardFooter
      activeStep={steps[activeStepIndex]}
      onNext={onNext}
      onBack={onBack}
      onClose={closeWizard}
      isNextDisabled={activeStepIndex === steps.length - 1}
      isBackDisabled={activeStepIndex === 0}
      nextButtonText={activeStepIndex === steps.length - 1 ? "Finish" : "Next"}
    />
  );
  const modalActions = [
    <Button key="back" variant="secondary" onClick={onBack} isDisabled={activeStepIndex === 0}>
      Back
    </Button>,
    <Button
      key="next"
      variant="primary"
      onClick={activeStepIndex === violations.length - 1 ? closeWizard : onNext}
    >
      {activeStepIndex === violations.length - 1 ? "Finish" : "Next"}
    </Button>,
  ];

  return (
    <Page>
      <PageSection>
        <Stack hasGutter>
          <StackItem>
            <Flex justifyContent={{ default: "justifyContentSpaceBetween" }}>
              <FlexItem>
                <Title headingLevel="h1" size="lg">
                  Konveyor Analysis
                </Title>
              </FlexItem>
              <FlexItem>
                <Flex>
                  <FlexItem>
                    <Button
                      variant={ButtonVariant.primary}
                      onClick={startAnalysis}
                      isLoading={isAnalyzing}
                      isDisabled={isAnalyzing}
                    >
                      {isAnalyzing ? "Analyzing..." : "Run Analysis"}
                    </Button>
                  </FlexItem>
                  {hasViolations && (
                    <FlexItem>
                      <Button variant={ButtonVariant.secondary} onClick={startGuidedApproach}>
                        Start Guided Approach
                      </Button>
                    </FlexItem>
                  )}
                </Flex>
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
            {hasViolations ? (
              <ViolationIncidentsList violations={violations} />
            ) : (
              <EmptyState>
                <EmptyStateIcon icon={SearchIcon} />
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
          </StackItem>
        </Stack>
      </PageSection>
      <Modal
        variant="small"
        isOpen={isWizardOpen}
        onClose={closeWizard}
        title="Guided Approach"
        description="Address issues one at a time"
        // actions={modalActions}
      >
        {isWizardOpen && hasViolations && (
          <Wizard
            nav={
              <WizardNav>
                {violations.map((violation, index) => (
                  <WizardNavItem
                    key={violation.id}
                    content={violation.description}
                    stepIndex={index}
                    id={`violation-step-${violation.id}`}
                  />
                ))}
              </WizardNav>
            }
            height={600}
            footer={CustomFooter}
          >
            {violations.map((violation, index) => (
              <WizardStep
                key={violation.id}
                name={violation.description}
                id={`violation-step-${violation.id}`}
                footer={{
                  nextButtonText: index === violations.length - 1 ? "Finish" : "Next Violation",
                }}
              >
                <ViolationIncidentsList
                  violations={[violation]}
                  focusedIncident={violation.incidents[0]}
                />
              </WizardStep>
            ))}
          </Wizard>
        )}
      </Modal>
    </Page>
  );
};

export default App;
