import React from "react";
import { Page, PageSection, Title } from "@patternfly/react-core";
import { useExtensionStateContext } from "../../context/ExtensionStateContext";
import { HubSettingsForm } from "./HubSettingsForm";

export const HubSettingsPage: React.FC = () => {
  const { state } = useExtensionStateContext();
  const { hubConfig } = state;

  if (!hubConfig) {
    throw new Error("Hub configuration not found. This should never happen.");
  }

  return (
    <Page>
      <PageSection>
        <Title headingLevel="h1" size="2xl" style={{ marginBottom: "1.5rem" }}>
          Hub Configuration
        </Title>
        <HubSettingsForm initialConfig={hubConfig} />
      </PageSection>
    </Page>
  );
};
