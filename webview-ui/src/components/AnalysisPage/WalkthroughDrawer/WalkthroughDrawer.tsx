import React from "react";
import {
  Card,
  CardHeader,
  CardBody,
  Gallery,
  GalleryItem,
  Title,
  DrawerPanelContent,
  DrawerHead,
  DrawerActions,
  DrawerCloseButton,
  DrawerContentBody,
  Content,
} from "@patternfly/react-core";
import { CheckCircleIcon, InProgressIcon, PendingIcon } from "@patternfly/react-icons";
import { AnalysisConfig } from "@editor-extensions/shared";

interface Step {
  id: string;
  title: string;
  description: string;
  completionEvents: string[];
  media: {
    markdown: string;
  };
}

interface Walkthrough {
  id: string;
  title: string;
  description: string;
  steps: Step[];
}

interface WalkthroughDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  drawerRef: React.RefObject<HTMLSpanElement>;
  analysisConfig: AnalysisConfig;
}

function getStepStatus(step: Step, analysisConfig?: AnalysisConfig) {
  if (step.id === "configure-analysis-arguments") {
    const valid = analysisConfig?.labelSelectorValid; // or more advanced checks
    return valid
      ? { icon: <CheckCircleIcon className="text-green-500" />, status: "Completed" }
      : { icon: <PendingIcon className="text-gray-500" />, status: "Not configured" };
  }

  // Default for steps relying on completionEvents or unknown state
  return {
    icon: <PendingIcon className="text-gray-500" />,
    status: "Unknown",
  };
}

export function WalkthroughDrawer({
  isOpen,
  onClose,
  drawerRef,
  analysisConfig,
}: WalkthroughDrawerProps) {
  const walkthroughs: Walkthrough[] = [
    {
      id: "konveyor-setup",
      title: "Set up Konveyor",
      description: "Configure Konveyor for your project",
      steps: [
        // {
        //   id: "override-analyzer",
        //   title: "Override Analyzer Binary",
        //   description: "Specify a custom path for the analyzer binary",
        //   completionEvents: [],
        //   media: {
        //     markdown: "media/walkthroughs/override-analyzer.md",
        //   },
        // },
        // {
        //   id: "configure-custom-rules",
        //   title: "Configure Custom Rules",
        //   description: "Add custom rules for analysis",
        //   completionEvents: ["onCommand:konveyor.configureCustomRules"],
        //   media: {
        //     markdown: "media/walkthroughs/custom-rules.md",
        //   },
        // },
        {
          id: "configure-analysis-arguments",
          title: "Configure Analysis Arguments",
          description: "Set up analysis arguments such as sources, targets, and label selector",
          completionEvents: [
            "onCommand:konveyor.configureSourcesTargets",
            "onCommand:konveyor.configureLabelSelector",
          ],
          media: {
            markdown: "media/walkthroughs/analysis-arguments.md",
          },
        },
        // {
        //   id: "configure-gen",
        //   title: "Configure Generative AI",
        //   description: "Configure Generative AI for your project",
        //   completionEvents: ["onCommand:konveyor.modelProviderSettingsOpen"],
        //   media: {
        //     markdown: "media/walkthroughs/gen-ai.md",
        //   },
        // },
        // {
        //   id: "open-analysis-panel",
        //   title: "Open Analysis Panel",
        //   description:
        //     "Open the Konveyor Analysis Panel to manage and monitor your analysis tasks.",
        //   completionEvents: [],
        //   media: {
        //     markdown: "media/walkthroughs/open-analysis-panel.md",
        //   },
        // },
      ],
    },
  ];
  return (
    <DrawerPanelContent>
      <DrawerHead>
        <span tabIndex={isOpen ? 0 : -1} ref={drawerRef}>
          Konveyor Setup Guide
        </span>
        <DrawerActions>
          <DrawerCloseButton onClick={onClose} />
        </DrawerActions>
      </DrawerHead>
      <DrawerContentBody>
        <div className="p-4">
          {walkthroughs.map((walkthrough) => (
            <div key={walkthrough.id} className="mb-8">
              <Title headingLevel="h2" className="mb-4">
                {walkthrough.title}
              </Title>
              <Content className="mb-6">{walkthrough.description}</Content>
              <Gallery hasGutter>
                {walkthrough.steps.map((step) => {
                  const { icon, status } = getStepStatus(step, analysisConfig);
                  return (
                    <GalleryItem key={step.id}>
                      <Card isCompact>
                        <CardHeader>
                          <div className="flex items-center gap-2">
                            {icon}
                            <Title headingLevel="h3" className="text-lg">
                              {step.title}
                            </Title>
                          </div>
                        </CardHeader>
                        <CardBody>
                          <Content className="mb-2">{step.description}</Content>
                          <Content className="text-sm text-gray-600">Status: {status}</Content>
                        </CardBody>
                      </Card>
                    </GalleryItem>
                  );
                })}
              </Gallery>
            </div>
          ))}
        </div>
      </DrawerContentBody>
    </DrawerPanelContent>
  );
}
