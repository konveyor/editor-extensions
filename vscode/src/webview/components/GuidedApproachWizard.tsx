import React, { useMemo, useState } from "react";
import {
  Wizard,
  WizardNav,
  WizardNavItem,
  WizardStep,
  WizardBasicStep,
  Button,
  TextContent,
  Text,
  TextVariants,
  Card,
  CardBody,
  Stack,
  StackItem,
} from "@patternfly/react-core";
import { Violation, Incident } from "../types";
import ViolationIncidentsList from "./ViolationIncidentsList";
import { vscode } from "../globals";

interface GuidedApproachWizardProps {
  violations: Violation[];
  isOpen: boolean;
  onClose: () => void;
}

const GuidedApproachWizard: React.FC<GuidedApproachWizardProps> = ({
  violations,
  isOpen,
  onClose,
}) => {
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>();
  const [quickFix, setQuickFix] = useState<string | null>(null);
  console.log("selectedIncident inside wizard", selectedIncident);

  const generateQuickFix = (violation: Violation, incident: Incident) => {
    // Send a message to the extension to trigger the quick fix
    vscode.postMessage({
      type: "requestQuickFix",
      data: {
        uri: incident.uri,
        line: incident.lineNumber,
        // Include any other necessary data
      },
    });
  };

  const steps: WizardBasicStep[] = useMemo(() => {
    return violations.map((violation, index) => ({
      index: index,
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
    }));
  }, [violations, selectedIncident, quickFix]);

  const onNext = () => {
    setActiveStepIndex((prev) => Math.min(prev + 1, steps.length - 1));
    setSelectedIncident(null);
    setQuickFix(null);
  };

  const onBack = () => {
    setActiveStepIndex((prev) => Math.max(prev - 1, 0));
    setSelectedIncident(null);
    setQuickFix(null);
  };

  //   const generateQuickFix = (violation: Violation, incident: Incident) => {
  //     // This is a placeholder. In a real application, you would call an API or use a more sophisticated method to generate the QuickFix.
  //     setQuickFix(
  //       `Suggested fix for ${violation.description}:\n\nReplace line ${incident.lineNumber} in ${incident.uri} with:\n// TODO: Implement fix for ${incident.message}`,
  //     );
  //   };

  //   const CustomFooter = (
  //     <WizardFooter
  //       activeStep={steps[activeStepIndex]}
  //       onNext={onNext}
  //       onBack={onBack}
  //       onClose={onClose}
  //       isNextDisabled={activeStepIndex === steps.length - 1}
  //       isBackDisabled={activeStepIndex === 0}
  //       nextButtonText={activeStepIndex === steps.length - 1 ? "Finish" : "Next"}
  //     />
  //   );

  return (
    <Wizard
      nav={
        <WizardNav>
          {violations.map((violation, index) => (
            <WizardNavItem
              key={violation.description}
              content={`Violation ${index + 1}`}
              stepIndex={index}
              id={`violation-step-${violation.description}`}
            />
          ))}
        </WizardNav>
      }
      height={600}
      //   footer={CustomFooter}
      onClose={onClose}
    >
      {steps.map((step) => (
        <WizardStep
          key={step.id}
          name={step.name}
          id={step.id}
          footer={{
            nextButtonText: step.index === violations.length - 1 ? "Finish" : "Next Violation",
            onNext: onNext,
            onBack: onBack,
          }}
        >
          {step.component}
        </WizardStep>
      ))}
    </Wizard>
  );
};

export default GuidedApproachWizard;
