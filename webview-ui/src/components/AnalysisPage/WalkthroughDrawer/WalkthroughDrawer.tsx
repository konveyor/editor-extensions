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
import { PencilAltIcon } from "@patternfly/react-icons";

import { useExtensionStateContext } from "../../../context/ExtensionStateContext";
import { TruncatedDescription } from "../../TruncatedDescription/TruncatedDescription";
import { enableGenAI } from "../../../hooks/actions";

export function WalkthroughDrawer({
  isOpen,
  onClose,
  drawerRef,
}: {
  isOpen: boolean;
  onClose: () => void;
  drawerRef: React.RefObject<HTMLSpanElement>;
}) {
  const { state, dispatch } = useExtensionStateContext();

  const profile = state.profiles.find((p) => p.id === state.activeProfileId);

  const labelSelectorValid = !!profile?.labelSelector?.trim();

  const rulesConfigured = !!profile?.useDefaultRules || (profile?.customRules?.length ?? 0) > 0;

  const providerConnectionError = state.configErrors.some(
    (error) => error.type === "provider-connection-failed",
  );
  const providerNotConfigured = state.configErrors.some(
    (error) => error.type === "provider-not-configured",
  );
  const genaiDisabled = state.configErrors.some((error) => error.type === "genai-disabled");
  const providerConfigured = !providerConnectionError && !providerNotConfigured && !genaiDisabled;

  const steps = [
    {
      id: "select-profile",
      title: "Select Profile",
      status: profile ? "Completed" : "Not configured",
      description: "Choose a profile for your analysis setup.",
      fullDescription:
        "Choose a profile for your analysis setup. Profiles define the scope of your analysis by specifying which technologies to target and which rules to apply. You can create multiple profiles for different types of projects or analysis scenarios.",
    },
    {
      id: "label-selector",
      title: "Configure Label Selector",
      status: labelSelectorValid ? "Completed" : "Not configured",
      description: "Used to target the technologies your project uses.",
      fullDescription:
        "Used to target the technologies your project uses. Label selectors help Konveyor identify which analysis rules are relevant to your specific technology stack. Common examples include 'java', 'spring-boot', 'hibernate', or custom labels that match your project's characteristics.",
    },
    {
      id: "rules",
      title: "Set Rules",
      status: rulesConfigured ? "Completed" : "Not configured",
      description: "Choose between default rules and your own custom rule files.",
      fullDescription:
        "Choose between default rules and your own custom rule files. Default rules cover common migration scenarios and best practices. Custom rules allow you to define project-specific analysis patterns, coding standards, or migration requirements tailored to your organization's needs.",
    },
    {
      id: "genai",
      title: genaiDisabled ? "Enable GenAI" : "Configure GenAI",
      status: genaiDisabled
        ? "GenAI is disabled"
        : providerConfigured
          ? "Completed"
          : providerConnectionError
            ? "Error connecting to the model"
            : "Not configured",
      description: genaiDisabled
        ? "GenAI functionality is currently disabled in your settings."
        : "Enable GenAI assistance using your API key.",
      fullDescription: genaiDisabled
        ? "GenAI functionality is currently disabled in your settings. When enabled, GenAI provides intelligent code suggestions, automated refactoring recommendations, and contextual explanations for migration issues. This feature enhances the analysis experience by offering AI-powered insights."
        : "Enable GenAI assistance using your API key. Configure your preferred AI provider (OpenAI, Azure OpenAI, or other compatible services) to unlock intelligent code analysis, automated suggestions, and enhanced migration recommendations powered by large language models.",
    },
  ];

  const getIcon = (status: string) =>
    status === "Completed" ? (
      <CheckCircleIcon color="green" className="status-icon--completed" />
    ) : (
      <PendingIcon
        className={`status-icon--not-configured ${status.includes("Default") ? "" : "warning-icon"}`}
      />
    );

  const getLabelStatus = (status: string) => {
    switch (status) {
      case "Completed":
        return "success";
      case "Default config in use":
        return "info";
      case "API key is missing":
        return "danger";
      case "Not configured":
        return "warning";
      case "GenAI is disabled":
        return "warning";
      default:
        return "info";
    }
  };

  return (
    <DrawerPanelContent>
      <DrawerHead>
        <span tabIndex={isOpen ? 0 : -1} ref={drawerRef}>
          <Stack hasGutter>
            <StackItem>
              <Title headingLevel="h2">Get Ready to Analyze</Title>
            </StackItem>
            <StackItem>
              <Content>Check your setup before running analysis.</Content>
            </StackItem>
          </Stack>
        </span>
        <DrawerActions>
          <DrawerCloseButton onClick={onClose} />
        </DrawerActions>
      </DrawerHead>

      <DrawerContentBody className="walkthrough-drawer-body">
        <Stack hasGutter>
          {steps.map((step) => (
            <StackItem key={step.id}>
              <Card isCompact>
                <CardHeader>
                  <Split hasGutter style={{ alignItems: "center" }}>
                    <SplitItem>
                      <Icon size="lg" isInline>
                        {getIcon(step.status)}
                      </Icon>
                    </SplitItem>
                    <SplitItem isFilled>
                      <Title headingLevel="h4">{step.title}</Title>
                    </SplitItem>
                    <SplitItem>
                      <Label variant="filled" status={getLabelStatus(step.status)}>
                        {step.status}
                      </Label>
                    </SplitItem>
                  </Split>
                </CardHeader>
                <CardBody>
                  <Stack hasGutter>
                    <StackItem>
                      <TruncatedDescription
                        shortText={step.description}
                        fullText={step.fullDescription}
                      />
                    </StackItem>
                    {step.id !== "genai" && (
                      <StackItem>
                        <Button
                          variant="link"
                          icon={<PencilAltIcon />}
                          onClick={() => dispatch({ type: "OPEN_PROFILE_MANAGER", payload: {} })}
                        >
                          Edit in Profile Manager
                        </Button>
                      </StackItem>
                    )}
                    {step.id === "genai" && (
                      <StackItem>
                        {genaiDisabled ? (
                          <Button variant="link" onClick={() => dispatch(enableGenAI())}>
                            Enable GenAI
                          </Button>
                        ) : (
                          <Button
                            variant="link"
                            onClick={() => dispatch({ type: "OPEN_GENAI_SETTINGS", payload: {} })}
                          >
                            Configure GenAI Settings
                          </Button>
                        )}
                      </StackItem>
                    )}
                  </Stack>
                </CardBody>
              </Card>
            </StackItem>
          ))}
        </Stack>
      </DrawerContentBody>
    </DrawerPanelContent>
  );
}
