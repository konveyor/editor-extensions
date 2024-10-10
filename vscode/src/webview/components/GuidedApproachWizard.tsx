import React, { useMemo, useState } from "react";
import {
  Wizard,
  WizardNav,
  WizardNavItem,
  WizardStep,
  WizardFooter,
  Button,
  TextContent,
  Text,
  TextVariants,
  Card,
  CardBody,
  Stack,
  StackItem,
  WizardBasicStep,
} from "@patternfly/react-core";
import { Violation, Incident } from "../types";
import ViolationIncidentsList from "./ViolationIncidentsList";
import { vscode } from "../globals";

interface GuidedApproachWizardProps {
  violations: Violation[];
  onClose: () => void;
}

const GuidedApproachWizard: React.FC<GuidedApproachWizardProps> = ({ violations, onClose }) => {
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [quickFix, setQuickFix] = useState<string | null>(null);

  const generateQuickFix = (violation: Violation, incident: Incident) => {
    vscode.postMessage({
      type: "requestQuickFix",
      data: {
        uri: incident.uri,
        line: incident.lineNumber,
      },
    });
  };

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
              onIncidentSelect={setSelectedIncident}
              compact={true}
            />
          </StackItem>
          <StackItem>
            <Card>
              <CardBody>
                <TextContent>
                  <Text component={TextVariants.h3}>Selected Incident</Text>
                  {selectedIncident ? (
                    <>
                      <Text component={TextVariants.p}>
                        <strong>Message:</strong> {selectedIncident.message}
                      </Text>
                      <Text component={TextVariants.p}>
                        <strong>File:</strong> {selectedIncident.uri}
                      </Text>
                      <Text component={TextVariants.p}>
                        <strong>Line:</strong> {selectedIncident.lineNumber}
                      </Text>
                      <Button
                        variant="primary"
                        onClick={() => generateQuickFix(violation, selectedIncident)}
                        isDisabled={!selectedIncident}
                      >
                        Generate QuickFix
                      </Button>
                    </>
                  ) : (
                    <Text component={TextVariants.p}>
                      Select an incident to see details and generate a QuickFix.
                    </Text>
                  )}
                </TextContent>
                {quickFix && (
                  <TextContent>
                    <Text component={TextVariants.h4}>QuickFix Suggestion:</Text>
                    <Text component={TextVariants.pre}>{quickFix}</Text>
                  </TextContent>
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
  );
};

export default GuidedApproachWizard;
