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

  const providerConfigured = state.analysisConfig.providerConfigured;
  const providerKeyMissing = state.analysisConfig.providerKeyMissing;

  const steps = [
    {
      id: "select-profile",
      title: "Select Profile",
      status: profile ? "Completed" : "Not configured",
      description: "Choose a profile for your analysis setup.",
    },
    {
      id: "label-selector",
      title: "Configure Label Selector",
      status: labelSelectorValid ? "Completed" : "Not configured",
      description: "Used to target the technologies your project uses.",
    },
    {
      id: "rules",
      title: "Set Rules",
      status: rulesConfigured ? "Completed" : "Not configured",
      description: "Choose between default rules and your own custom rule files.",
    },
    {
      id: "genai",
      title: "Configure GenAI",
      status: providerConfigured
        ? "Completed"
        : providerKeyMissing
          ? "API key is missing"
          : "Not configured",
      description: "Enable GenAI assistance using your API key.",
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
                        fullText={step.description}
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
                        <Button
                          variant="link"
                          onClick={() => dispatch({ type: "OPEN_GENAI_SETTINGS", payload: {} })}
                        >
                          Configure GenAI Settings
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
