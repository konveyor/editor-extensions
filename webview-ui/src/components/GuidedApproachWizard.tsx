import React, { useMemo, useState, useEffect } from "react";
import {
  Wizard,
  WizardNav,
  WizardNavItem,
  WizardStep,
  WizardFooter,
  Button,
  Content,
  ContentVariants,
  Card,
  CardBody,
  Stack,
  StackItem,
  WizardBasicStep,
} from "@patternfly/react-core";
import ViolationIncidentsList from "./ViolationIncidentsList";
import { vscode } from "../utils/vscode";
import { Incident, Violation } from "@editor-extensions/shared/src/types";

interface GuidedApproachWizardProps {
  violations: Violation[];
  onClose: () => void;
}

const GuidedApproachWizard: React.FC<GuidedApproachWizardProps> = ({
  violations,
  onClose,
}) => {
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(
    null,
  );
  const [quickFix, setQuickFix] = useState<string | null>(null);
  const [expandedViolations, setExpandedViolations] = useState<Set<string>>(
    new Set(),
  );

  const generateQuickFix = (incident: Incident) => {
    vscode.postMessage({
      type: "requestQuickFix",
      data: {
        uri: incident.uri,
        line: incident.lineNumber,
      },
    });
  };

  const handleIncidentClick = (incident: Incident) => {
    setSelectedIncident(incident);
    vscode.postMessage({
      command: "openFile",
      file: incident.uri,
      line: incident.lineNumber,
    });
  };

  // Auto-select the first incident when the wizard opens or when navigating to a new step
  useEffect(() => {
    if (
      violations[activeStepIndex] &&
      violations[activeStepIndex].incidents.length > 0
    ) {
      const firstIncident = violations[activeStepIndex].incidents[0];
      setSelectedIncident(firstIncident);
      handleIncidentClick(firstIncident);
      setExpandedViolations(new Set([violations[activeStepIndex].description]));
    } else {
      setSelectedIncident(null);
    }
    setQuickFix(null);
  }, [activeStepIndex, violations]);

  // Define the wizard steps
  const steps: WizardBasicStep[] = useMemo(() => {
    return violations.map((violation, index) => ({
      id: `violation-step-${violation.description}`,
      name: `Violation ${index + 1}`,
      component: (
        <Stack hasGutter>
          <StackItem>
            <ViolationIncidentsList
              violations={[violation]}
              focusedIncident={selectedIncident}
              onIncidentSelect={handleIncidentClick}
              compact={true}
              expandedViolations={expandedViolations}
              setExpandedViolations={setExpandedViolations}
            />
          </StackItem>
          <StackItem>
            <Card>
              <CardBody>
                <Content>
                  <Content component={ContentVariants.h3}>
                    Selected Incident
                  </Content>
                  {selectedIncident ? (
                    <>
                      <Content component={ContentVariants.p}>
                        <strong>Message:</strong> {selectedIncident.message}
                      </Content>
                      <Content component={ContentVariants.p}>
                        <strong>File:</strong> {selectedIncident.uri}
                      </Content>
                      <Content component={ContentVariants.p}>
                        <strong>Line:</strong> {selectedIncident.lineNumber}
                      </Content>
                      <Button
                        variant="primary"
                        onClick={() => generateQuickFix(selectedIncident)}
                      >
                        Generate QuickFix
                      </Button>
                    </>
                  ) : (
                    <Content component={ContentVariants.p}>
                      No incidents found for this violation.
                    </Content>
                  )}
                </Content>
                {quickFix && (
                  <Content>
                    <Content component={ContentVariants.h4}>
                      QuickFix Suggestion:
                    </Content>
                    <Content component={ContentVariants.pre}>
                      {quickFix}
                    </Content>
                  </Content>
                )}
              </CardBody>
            </Card>
          </StackItem>
        </Stack>
      ),
      canJumpTo: true,
      index: index,
    }));
  }, [violations, selectedIncident, quickFix]);

  // Handlers for navigation
  const onNext = () => {
    setActiveStepIndex((prev) => Math.min(prev + 1, steps.length - 1));
    setSelectedIncident(null);
    setQuickFix(null);
    if (activeStepIndex === steps.length - 1) {
      onClose();
    }
  };

  const onBack = () => {
    setActiveStepIndex((prev) => Math.max(prev - 1, 0));
    setSelectedIncident(null);
    setQuickFix(null);
  };

  // Custom Footer Component
  const CustomFooter = (
    <WizardFooter
      activeStep={steps[activeStepIndex]} // Pass the current active step object
      onNext={activeStepIndex === steps.length - 1 ? onClose : onNext} // On the last step, clicking Next should close
      onBack={onBack}
      onClose={onClose}
      isBackDisabled={activeStepIndex === 0} // Only disable Back on the first step
      nextButtonText={activeStepIndex === steps.length - 1 ? "Finish" : "Next"} // Update the button text on the last step
    />
  );

  return (
    <>
      <Wizard
        height={600}
        nav={
          <WizardNav>
            {steps.map((step, index) => (
              <WizardNavItem
                key={step.id}
                content={step.name}
                stepIndex={index}
                id={step.id}
                isCurrent={index === activeStepIndex}
                onClick={() => setActiveStepIndex(index)}
              />
            ))}
          </WizardNav>
        }
        footer={CustomFooter}
        onClose={onClose}
      >
        <WizardStep
          id={steps[activeStepIndex].id}
          name={steps[activeStepIndex].name}
          footer={CustomFooter}
        >
          {steps[activeStepIndex].component}
        </WizardStep>
      </Wizard>
    </>
  );
};

export default GuidedApproachWizard;
