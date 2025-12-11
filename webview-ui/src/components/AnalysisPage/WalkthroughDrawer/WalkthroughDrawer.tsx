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

import { useExtensionStore } from "../../../store/store";
import { sendVscodeMessage as dispatch } from "../../../utils/vscodeMessaging";
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
  // ✅ Selective subscriptions
  const profiles = useExtensionStore((state) => state.profiles);
  const activeProfileId = useExtensionStore((state) => state.activeProfileId);
  const isInTreeMode = useExtensionStore((state) => state.isInTreeMode);
  const configErrors = useExtensionStore((state) => state.configErrors);
  const hubConfig = useExtensionStore((state) => state.hubConfig);
  const llmProxyAvailable = useExtensionStore((state) => state.llmProxyAvailable);
  const profileSyncConnected = useExtensionStore((state) => state.profileSyncConnected);
  const solutionServerConnected = useExtensionStore((state) => state.solutionServerConnected);

  const profile = profiles.find((p) => p.id === activeProfileId);

  const labelSelectorValid = !!profile?.labelSelector?.trim();

  const rulesConfigured = !!profile?.useDefaultRules || (profile?.customRules?.length ?? 0) > 0;

  const providerConnectionError = configErrors.some(
    (error) => error.type === "provider-connection-failed",
  );
  const providerNotConfigured = configErrors.some(
    (error) => error.type === "provider-not-configured",
  );
  const genaiDisabled = configErrors.some((error) => error.type === "genai-disabled");
  const providerConfigured = !providerConnectionError && !providerNotConfigured && !genaiDisabled;

  // Check hub configuration status
  // Must have URL, and if auth is enabled, must have credentials
  const hubFieldsConfigured =
    hubConfig?.enabled &&
    !!hubConfig?.url?.trim() &&
    (!hubConfig?.auth.enabled ||
      (!!hubConfig?.auth.username?.trim() && !!hubConfig?.auth.password?.trim()));

  // Hub is "connected" if any feature is actually connected
  const hubConnected = profileSyncConnected || solutionServerConnected;

  // Check if any Hub features are enabled
  const anyHubFeatureEnabled =
    hubConfig?.features?.profileSync?.enabled || hubConfig?.features?.solutionServer?.enabled;

  const disabledDescription = "This feature is disabled based on your configuration.";
  const disabledFullDescription =
    "This feature is disabled because the values are managed by the in-tree profile currently selected.";
  const genaiManagedByHubDescription = "GenAI is configured via Konveyor Hub.";
  const genaiManagedByHubFullDescription =
    "GenAI is configured via Konveyor Hub. The LLM proxy provides centralized AI capabilities without requiring local API key configuration. Your requests are routed through the Hub's managed service.";

  // Determine hub status message
  const getHubStatus = () => {
    if (!hubConfig?.enabled) {
      return "Not configured";
    }
    if (!hubConfig?.url?.trim()) {
      return "URL not set";
    }
    if (
      hubConfig?.auth.enabled &&
      (!hubConfig?.auth.username?.trim() || !hubConfig?.auth.password?.trim())
    ) {
      return "Missing credentials";
    }

    if (hubFieldsConfigured && !anyHubFeatureEnabled) {
      return "No features enabled";
    }

    if (hubFieldsConfigured && anyHubFeatureEnabled && !hubConnected) {
      return "Connection failed";
    }

    if (hubFieldsConfigured && anyHubFeatureEnabled && hubConnected) {
      return "Completed";
    }

    return "Not configured";
  };

  const steps = [
    {
      id: "hub-config",
      title: "Hub Configuration",
      status: getHubStatus(),
      description: "Connect to Konveyor Hub for advanced features.",
      fullDescription:
        "Connect to Konveyor Hub to enable profile synchronization, solution server capabilities, and other advanced features. The Hub provides centralized management and enhanced collaboration capabilities for your migration projects.",
    },
    {
      id: "select-profile",
      title: "Select Profile",
      status: isInTreeMode ? "Disabled" : profile ? "Completed" : "Not configured",
      description: isInTreeMode ? disabledDescription : "Choose a profile for your analysis setup.",
      fullDescription: isInTreeMode
        ? disabledFullDescription
        : "Choose a profile for your analysis setup. Profiles define the scope of your analysis by specifying which technologies to target and which rules to apply. You can create multiple profiles for different types of projects or analysis scenarios.",
    },
    {
      id: "label-selector",
      title: "Configure Label Selector",
      status: isInTreeMode ? "Disabled" : labelSelectorValid ? "Completed" : "Not configured",
      description: isInTreeMode
        ? disabledDescription
        : "Used to target the technologies your project uses.",
      fullDescription: isInTreeMode
        ? disabledFullDescription
        : "Used to target the technologies your project uses. Label selectors help Konveyor identify which analysis rules are relevant to your specific technology stack. Common examples include 'java', 'spring-boot', 'hibernate', or custom labels that match your project's characteristics.",
    },
    {
      id: "rules",
      title: "Set Rules",
      status: isInTreeMode ? "Disabled" : rulesConfigured ? "Completed" : "Not configured",
      description: isInTreeMode
        ? disabledDescription
        : "Choose between default rules and your own custom rule files.",
      fullDescription: isInTreeMode
        ? disabledFullDescription
        : "Choose between default rules and your own custom rule files. Default rules cover common migration scenarios and best practices. Custom rules allow you to define project-specific analysis patterns, coding standards, or migration requirements tailored to your organization's needs.",
    },
    {
      id: "genai",
      title: genaiDisabled && !llmProxyAvailable ? "Enable GenAI" : "Configure GenAI",
      status: llmProxyAvailable
        ? "Disabled"
        : genaiDisabled
          ? "GenAI is disabled"
          : providerConfigured
            ? "Completed"
            : providerConnectionError
              ? "Error connecting to the model"
              : "Not configured",
      description: llmProxyAvailable
        ? genaiManagedByHubDescription
        : genaiDisabled
          ? "GenAI functionality is currently disabled in your settings."
          : "Enable GenAI assistance using your API key.",
      fullDescription: llmProxyAvailable
        ? genaiManagedByHubFullDescription
        : genaiDisabled
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
      case "Disabled":
        return "info";
      case "Connection failed":
        return "danger";
      case "Missing credentials":
        return "warning";
      case "URL not set":
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
                    {step.id !== "genai" && step.id !== "hub-config" && !isInTreeMode && (
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
                    {step.id === "genai" && !llmProxyAvailable && (
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
                    {step.id === "hub-config" && (
                      <StackItem>
                        <Button
                          variant="link"
                          icon={<PencilAltIcon />}
                          onClick={() => dispatch({ type: "OPEN_HUB_SETTINGS", payload: {} })}
                        >
                          Configure Hub Settings
                        </Button>
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
