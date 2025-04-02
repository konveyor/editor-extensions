import React from "react";
import {
  Button,
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
  Stack,
  StackItem,
  Split,
  SplitItem,
  Label,
  Panel,
  Icon,
} from "@patternfly/react-core";
import CheckCircleIcon from "@patternfly/react-icons/dist/esm/icons/check-circle-icon";
import PendingIcon from "@patternfly/react-icons/dist/esm/icons/pending-icon";
import { AnalysisConfig } from "@editor-extensions/shared";
import { useExtensionStateContext } from "../../../context/ExtensionStateContext";
import {
  t_global_color_status_success_default as pfSuccessColor,
  t_global_text_color_status_on_success_default as pfSuccessTextColor,
  t_global_icon_color_nonstatus_on_green_default as pfSuccessIconColor,
} from "@patternfly/react-tokens";

import "./walkthroughDrawer.css";

interface Step {
  id: string;
  title: string;
  description: string;
  actions: Array<{
    label: string;
    command: string;
  }>;
  completionEvents?: string[];
}

interface WalkthroughDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  drawerRef: React.RefObject<HTMLSpanElement>;
  analysisConfig: AnalysisConfig;
}

function getStepStatus(step: Step, analysisConfig?: AnalysisConfig) {
  if (step.id === "configure-analysis-arguments") {
    const valid = analysisConfig?.labelSelectorValid;
    return valid
      ? {
          icon: <CheckCircleIcon color="green" className="status-icon--completed" />,
          status: "Completed",
          variant: "success" as const,
        }
      : {
          icon: <PendingIcon className="status-icon--not-configured" />,
          status: "Not configured",
          variant: "outline" as const,
        };
  }

  // For other steps, check if they have completion events
  if (step.completionEvents?.length === 0) {
    return {
      icon: <PendingIcon className="status-icon--not-configured" />,
      status: "Optional",
      variant: "outline" as const,
    };
  }

  return {
    icon: <PendingIcon className="status-icon--not-configured" />,
    status: "Not configured",
    variant: "outline" as const,
  };
}

export function WalkthroughDrawer({
  isOpen,
  onClose,
  drawerRef,
  analysisConfig,
}: WalkthroughDrawerProps) {
  const { dispatch } = useExtensionStateContext();

  const steps: Step[] = [
    {
      id: "override-analyzer",
      title: "Override Analyzer Binary",
      description: "Specify a custom path for the analyzer binary",
      actions: [
        {
          label: "Override Analyzer Binary",
          command: "konveyor.overrideAnalyzerBinaries",
        },
        {
          label: "Override RPC Server Binary",
          command: "konveyor.overrideKaiRpcServerBinaries",
        },
      ],
      completionEvents: [],
    },
    {
      id: "configure-custom-rules",
      title: "Configure Custom Rules",
      description: "Add custom rules for analysis",
      actions: [
        {
          label: "Configure Custom Rules",
          command: "konveyor.configureCustomRules",
        },
      ],
      completionEvents: ["onCommand:konveyor.configureCustomRules"],
    },
    {
      id: "configure-analysis-arguments",
      title: "Configure Analysis Arguments",
      description: "Set up analysis arguments such as sources, targets, and label selector",
      actions: [
        {
          label: "Configure Sources and Targets",
          command: "konveyor.configureSourcesTargets",
        },
        {
          label: "Configure Label Selector",
          command: "konveyor.configureLabelSelector",
        },
      ],
      completionEvents: [
        "onCommand:konveyor.configureSourcesTargets",
        "onCommand:konveyor.configureLabelSelector",
      ],
    },
    {
      id: "configure-gen",
      title: "Configure Generative AI",
      description: "Configure Generative AI for your project",
      actions: [
        {
          label: "Configure GenAI Settings",
          command: "konveyor.modelProviderSettingsOpen",
        },
      ],
      completionEvents: ["onCommand:konveyor.modelProviderSettingsOpen"],
    },
    {
      id: "open-analysis-panel",
      title: "Open Analysis Panel",
      description:
        "Open the Konveyor Analysis Panel to manage and monitor your analysis tasks. The Kai server processes analysis requests, so ensure it is started before running any analysis tasks.",
      actions: [
        {
          label: "Open Analysis Panel",
          command: "konveyor.showAnalysisPanel",
        },
      ],
      completionEvents: [],
    },
  ];

  const handleCommand = (command: string) => {
    if (command === "konveyor.configureSourcesTargets") {
      dispatch({ type: "CONFIGURE_SOURCES_TARGETS", payload: {} });
    }
  };

  function getLabelStatus(status: string) {
    switch (status) {
      case "Completed":
        return "success";
      case "Not configured":
        return "warning";
      default:
        return "info"; // or "blue", "cyan", etc.
    }
  }

  return (
    <DrawerPanelContent>
      <DrawerHead>
        <span tabIndex={isOpen ? 0 : -1} ref={drawerRef}>
          <Stack hasGutter>
            <StackItem>
              <Title headingLevel="h2">Set up Konveyor</Title>
            </StackItem>
            <StackItem>
              <Content>Configure Konveyor for your project</Content>
            </StackItem>
          </Stack>
        </span>
        <DrawerActions>
          <DrawerCloseButton onClick={onClose} />
        </DrawerActions>
      </DrawerHead>
      <DrawerContentBody className="walkthrough-drawer-body">
        <Stack hasGutter>
          <StackItem>
            <Gallery hasGutter>
              {steps.map((step) => {
                const { icon, status, variant } = getStepStatus(step, analysisConfig);
                return (
                  <GalleryItem key={step.id}>
                    <Card isCompact>
                      <CardHeader>
                        <Split hasGutter style={{ alignItems: "center" }}>
                          <SplitItem>
                            <Icon size="lg">{icon}</Icon>
                          </SplitItem>
                          <SplitItem isFilled>
                            <Title headingLevel="h4">{step.title}</Title>
                          </SplitItem>
                          <SplitItem>
                            <Label variant="filled" status={getLabelStatus(status)}>
                              {status}
                            </Label>
                          </SplitItem>
                        </Split>
                      </CardHeader>
                      <CardBody>
                        <Stack hasGutter>
                          <StackItem>
                            <Content>{step.description}</Content>
                          </StackItem>
                          <StackItem>
                            <Stack hasGutter>
                              {step.actions.map((action, index) => (
                                <StackItem key={index}>
                                  <Button
                                    variant="plain"
                                    onClick={() => handleCommand(action.command)}
                                  >
                                    {action.label}
                                  </Button>
                                </StackItem>
                              ))}
                            </Stack>
                          </StackItem>
                        </Stack>
                      </CardBody>
                    </Card>
                  </GalleryItem>
                );
              })}
            </Gallery>
          </StackItem>
        </Stack>
      </DrawerContentBody>
    </DrawerPanelContent>
  );
}
