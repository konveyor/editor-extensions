import React from "react";
import {
  Card,
  CardBody,
  Button,
  Label,
  Split,
  SplitItem,
  Flex,
  FlexItem,
  Content,
  ContentVariants,
  Radio,
  FormGroup,
} from "@patternfly/react-core";
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  DisconnectedIcon,
} from "@patternfly/react-icons";
import { sendVscodeMessage as dispatch } from "../../utils/vscodeMessaging";
import { useExtensionStore } from "../../store/store";
import { HubAuthMethod } from "@editor-extensions/shared";

function formatRelativeTime(epochMs: number): string {
  const now = Date.now();
  const diff = epochMs - now;

  if (diff <= 0) {
    return "expired";
  }

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `in ${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `in ${minutes}m`;
  }
  return "expiring soon";
}

export const HubConnectionStatus: React.FC = () => {
  const solutionServerConnected = useExtensionStore((s) => s.solutionServerConnected);
  const profileSyncConnected = useExtensionStore((s) => s.profileSyncConnected);
  const llmProxyAvailable = useExtensionStore((s) => s.llmProxyAvailable);
  const oidcUsername = useExtensionStore((s) => s.oidcUsername);
  const oidcTokenExpiry = useExtensionStore((s) => s.oidcTokenExpiry);
  const hubConfig = useExtensionStore((s) => s.hubConfig);

  const isConnected = solutionServerConnected || profileSyncConnected || llmProxyAvailable;
  const isHubEnabled = hubConfig?.enabled ?? false;
  const authMethod: HubAuthMethod = hubConfig?.auth?.method ?? "oidc";
  const isOidc = authMethod === "oidc";

  const handleSignOut = () => {
    dispatch({ type: "HUB_OIDC_LOGOUT" as any, payload: {} });
  };

  const handleReconnect = () => {
    dispatch({ type: "HUB_RECONNECT" as any, payload: {} });
  };

  const handleAuthMethodChange = (method: HubAuthMethod) => {
    if (!hubConfig) return;
    dispatch({
      type: "UPDATE_HUB_CONFIG" as any,
      payload: {
        ...hubConfig,
        auth: { ...hubConfig.auth, method },
      },
    });
  };

  return (
    <Card isCompact style={{ marginBottom: "1.5rem" }}>
      <CardBody>
        <Split hasGutter>
          <SplitItem>
            <Label
              color={isConnected ? "green" : "red"}
              icon={isConnected ? <CheckCircleIcon /> : <DisconnectedIcon />}
            >
              {isConnected ? "Connected" : "Disconnected"}
            </Label>
          </SplitItem>

          {isConnected && oidcUsername && (
            <SplitItem>
              <Content component={ContentVariants.small}>
                Signed in as <strong>{oidcUsername}</strong>
              </Content>
            </SplitItem>
          )}

          {isConnected && oidcTokenExpiry && (
            <SplitItem>
              <Content
                component={ContentVariants.small}
                style={{
                  color:
                    oidcTokenExpiry - Date.now() < 300000
                      ? "var(--pf-v5-global--warning-color--100)"
                      : "var(--pf-v5-global--Color--200)",
                }}
              >
                Token expires {formatRelativeTime(oidcTokenExpiry)}
              </Content>
            </SplitItem>
          )}

          <SplitItem isFilled />

          {isConnected && isOidc && (
            <SplitItem>
              <Button variant="secondary" isDanger onClick={handleSignOut}>
                Sign Out
              </Button>
            </SplitItem>
          )}

          {!isConnected && isHubEnabled && isOidc && (
            <SplitItem>
              <Button variant="primary" onClick={handleReconnect}>
                Sign In
              </Button>
            </SplitItem>
          )}
        </Split>

        {/* Auth method selector */}
        {isHubEnabled && !isConnected && (
          <FormGroup
            label="Authentication method"
            fieldId="auth-method-status"
            style={{ marginTop: "1rem" }}
          >
            <Flex style={{ gap: "1rem" }}>
              <FlexItem>
                <Radio
                  isChecked={isOidc}
                  name="auth-method-status"
                  onChange={() => handleAuthMethodChange("oidc")}
                  label="OIDC (Single Sign-On)"
                  id="auth-method-status-oidc"
                />
              </FlexItem>
              <FlexItem>
                <Radio
                  isChecked={authMethod === "credentials"}
                  name="auth-method-status"
                  onChange={() => handleAuthMethodChange("credentials")}
                  label="Credentials (Legacy)"
                  id="auth-method-status-credentials"
                />
              </FlexItem>
            </Flex>
          </FormGroup>
        )}

        {/* Feature-level status chips */}
        {isHubEnabled && (
          <Flex style={{ marginTop: "0.75rem", gap: "0.5rem" }}>
            <FlexItem>
              <Label
                color={solutionServerConnected ? "green" : "grey"}
                icon={
                  solutionServerConnected ? <CheckCircleIcon /> : <ExclamationCircleIcon />
                }
                isCompact
              >
                Solution Server
              </Label>
            </FlexItem>
            <FlexItem>
              <Label
                color={profileSyncConnected ? "green" : "grey"}
                icon={
                  profileSyncConnected ? <CheckCircleIcon /> : <ExclamationCircleIcon />
                }
                isCompact
              >
                Profile Sync
              </Label>
            </FlexItem>
            <FlexItem>
              <Label
                color={llmProxyAvailable ? "green" : "grey"}
                icon={llmProxyAvailable ? <CheckCircleIcon /> : <ExclamationCircleIcon />}
                isCompact
              >
                LLM Proxy
              </Label>
            </FlexItem>
          </Flex>
        )}
      </CardBody>
    </Card>
  );
};
