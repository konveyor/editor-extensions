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
  priority: number;
  actions: Array<{
    label: string;
    command: string;
  }>;
}

interface WalkthroughDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  drawerRef: React.RefObject<HTMLSpanElement>;
  analysisConfig: AnalysisConfig;
}

function getStepStatus(step: Step, analysisConfig?: AnalysisConfig) {
  // Helper function to create status objects
  const createStatus = (isCompleted: boolean) => {
    return isCompleted
      ? {
          icon: <CheckCircleIcon color="green" className="status-icon--completed" />,
          status: "Completed",
          variant: "success" as const,
        }
      : {
          icon: <PendingIcon className="status-icon--not-configured" />,
          status: step.priority === 0 ? "Optional" : "Not configured",
          variant: "outline" as const,
        };
  };

  switch (step.id) {
    case "configure-analysis-arguments":
      if (analysisConfig?.labelSelectorValid === false) {
        return {
          icon: <PendingIcon className="status-icon--not-configured warning-icon" />,
          status: "Analysis arguments not set",
          variant: "outline" as const,
        };
      }
      return createStatus(true);

    case "configure-gen":
      if (analysisConfig?.genAIKeyMissing) {
        return {
          icon: <PendingIcon className="status-icon--not-configured warning-icon" />,
          status: "Key not set",
          variant: "outline" as const,
        };
      }

      if (!analysisConfig?.genAIConfigured && analysisConfig?.genAIUsingDefault) {
        return {
          icon: <PendingIcon className="status-icon--not-configured" />,
          status: "Default config in use",
          variant: "outline" as const,
        };
      }

      return createStatus(true);

    case "configure-custom-rules":
      return createStatus(analysisConfig?.customRulesConfigured === true);

    default:
      return {
        icon: <PendingIcon className="status-icon--not-configured" />,
        status: step.priority === 0 ? "Optional" : "Not configured",
        variant: "outline" as const,
      };
  }
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
      id: "configure-analysis-arguments",
      title: "Configure Analysis Arguments",
      description: "Set up analysis arguments such as sources, targets, and label selector",
      priority: 3, // Highest priority - must be configured
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
    },
    {
      id: "configure-gen",
      title: "Configure Generative AI",
      description: "Configure Generative AI for your project",
      priority: 2, // Second highest priority - required
      actions: [
        {
          label: "Configure GenAI Settings",
          command: "konveyor.modelProviderSettingsOpen",
        },
      ],
    },
    {
      id: "configure-custom-rules",
      title: "Configure Custom Rules",
      description: "Add custom rules for analysis",
      priority: 0,
      actions: [
        {
          label: "Configure Custom Rules",
          command: "konveyor.configureCustomRules",
        },
      ],
    },
    {
      id: "override-analyzer",
      title: "Override Analyzer Binary",
      description: "Specify a custom path for the analyzer binary",
      priority: 0, // Optional
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
    },
  ].sort((a, b) => b.priority - a.priority);

  const handleCommand = (command: string) => {
    switch (command) {
      case "konveyor.configureSourcesTargets":
        dispatch({ type: "CONFIGURE_SOURCES_TARGETS", payload: {} });
        break;
      case "konveyor.configureLabelSelector":
        dispatch({ type: "CONFIGURE_LABEL_SELECTOR", payload: {} });
        break;
      case "konveyor.modelProviderSettingsOpen":
        dispatch({ type: "OPEN_GENAI_SETTINGS", payload: {} });
        break;
      case "konveyor.configureCustomRules":
        dispatch({ type: "CONFIGURE_CUSTOM_RULES", payload: {} });
        break;
      case "konveyor.overrideAnalyzerBinaries":
        dispatch({ type: "OVERRIDE_ANALYZER_BINARIES", payload: {} });
        break;
      case "konveyor.overrideKaiRpcServerBinaries":
        dispatch({ type: "OVERRIDE_RPC_SERVER_BINARIES", payload: {} });
        break;
    }
  };

  function getLabelStatus(status: string) {
    switch (status) {
      case "Completed":
        return "success";
      case "Default config in use":
        return "info";
      case "Not configured":
        return "warning";
      case "Analysis arguments not set":
        return "danger";
      case "Key not set":
        return "danger";
      default:
        return "info";
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
            <Stack hasGutter>
              {steps.map((step) => {
                const { icon, status, variant } = getStepStatus(step, analysisConfig);
                return (
                  <StackItem key={step.id}>
                    <Card isCompact>
                      <CardHeader>
                        <Split hasGutter style={{ alignItems: "center" }}>
                          <SplitItem>
                            <Icon size="lg" isInline>
                              {icon}
                            </Icon>
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
                            <Content className="step-description">{step.description}</Content>
                          </StackItem>
                          <StackItem>
                            <Stack hasGutter>
                              {step.actions.map((action, index) => (
                                <StackItem key={index}>
                                  <Button
                                    variant="secondary"
                                    onClick={() => handleCommand(action.command)}
                                    className="step-action-button"
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
                  </StackItem>
                );
              })}
            </Stack>
          </StackItem>
        </Stack>
      </DrawerContentBody>
    </DrawerPanelContent>
  );
}

export default WalkthroughDrawer;
