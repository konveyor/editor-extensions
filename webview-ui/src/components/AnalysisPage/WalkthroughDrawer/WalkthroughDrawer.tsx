import "./walkthroughDrawer.css";
import React from "react";
import {
  Button,
  Card,
  CardHeader,
  CardBody,
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
  Icon,
} from "@patternfly/react-core";
import CheckCircleIcon from "@patternfly/react-icons/dist/esm/icons/check-circle-icon";
import PendingIcon from "@patternfly/react-icons/dist/esm/icons/pending-icon";
import { AnalysisConfig } from "@editor-extensions/shared";
import { useExtensionStateContext } from "../../../context/ExtensionStateContext";
import { TruncatedDescription } from "../../TruncatedDescription/TruncatedDescription";

interface Step {
  id: string;
  title: string;
  shortDescription: string;
  fullDescription: string;
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
      shortDescription: "Set up sources, targets, and label selector...",
      fullDescription:
        "Set up analysis arguments such as sources, targets, and label selector. The labelSelector determines which rules apply to your project during analysis. You can configure it using the “Configure Sources and Targets” or “Configure Label Selector” commands.",
      priority: 3,
      actions: [
        { label: "Configure Sources and Targets", command: "konveyor.configureSourcesTargets" },
        { label: "Configure Label Selector", command: "konveyor.configureLabelSelector" },
      ],
    },
    {
      id: "configure-gen",
      title: "Configure Generative AI",
      shortDescription: "Enable GenAI features using your API key...",
      fullDescription:
        "GenAI is a powerful tool that can help generate code snippets, documentation, and more. Set your API key to enable GenAI in the Konveyor extension.",
      priority: 2,
      actions: [
        { label: "Configure GenAI Settings", command: "konveyor.modelProviderSettingsOpen" },
      ],
    },
    {
      id: "configure-custom-rules",
      title: "Configure Custom Rules",
      shortDescription: "Add your own rules to customize analysis...",
      fullDescription:
        "The Konveyor extension allows you to add custom rules to the analyzer. This is useful if you want to tailor the analysis to your project's specific needs. Run the 'Configure Custom Rules' command to select the rule files.",
      priority: 0,
      actions: [{ label: "Configure Custom Rules", command: "konveyor.configureCustomRules" }],
    },
    {
      id: "override-analyzer",
      title: "Override Analyzer Binary",
      shortDescription: "Use custom binaries for analyzer or RPC...",
      fullDescription:
        "The Konveyor extension comes packaged with default analyzer and RPC server binaries. You can override these with custom versions by running the corresponding override commands from the command palette.",
      priority: 0,
      actions: [
        { label: "Override Analyzer Binary", command: "konveyor.overrideAnalyzerBinaries" },
        { label: "Override RPC Server Binary", command: "konveyor.overrideKaiRpcServerBinaries" },
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
                const { icon, status } = getStepStatus(step, analysisConfig);
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
                            <TruncatedDescription
                              shortText={step.shortDescription}
                              fullText={step.fullDescription}
                            />
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
