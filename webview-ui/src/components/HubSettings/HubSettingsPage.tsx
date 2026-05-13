import React from "react";
import { Page, PageSection, Title, EmptyState, EmptyStateBody } from "@patternfly/react-core";
import { useExtensionStore } from "../../store/store";
import { HubSettingsForm } from "./HubSettingsForm";

export const HubSettingsPage: React.FC = () => {
  const hubConfig = useExtensionStore((state) => state.hubConfig);
  const hubForced = useExtensionStore((state) => state.hubForced);

  if (!hubConfig) {
    return (
      <Page>
        <PageSection>
          <EmptyState>
            <EmptyStateBody>Loading hub configuration...</EmptyStateBody>
          </EmptyState>
        </PageSection>
      </Page>
    );
  }

  return (
    <Page>
      <PageSection>
        <Title headingLevel="h1" size="2xl" style={{ marginBottom: "1.5rem" }}>
          Hub Configuration
        </Title>
        <HubSettingsForm initialConfig={hubConfig} hubForced={hubForced} />
      </PageSection>
    </Page>
  );
};
