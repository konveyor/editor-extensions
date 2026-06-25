import React, { useEffect, useState } from "react";
import {
  Card,
  CardBody,
  Button,
  HelperText,
  HelperTextItem,
  Label,
  Split,
  SplitItem,
  Flex,
  FlexItem,
  Content,
  ContentVariants,
} from "@patternfly/react-core";
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  DisconnectedIcon,
} from "@patternfly/react-icons";
import { useExtensionStore } from "../../store/store";
import { sendVscodeMessage as dispatch } from "../../utils/vscodeMessaging";
import { HubAuthMethod } from "@editor-extensions/shared";

function formatRelativeTime(epochMs: number): string {
  const now = Date.now();
  const diff = epochMs - now;

  if (diff <= 0) {
    return "expired";
  }

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);

  if (hours >= 24) {
    const date = new Date(epochMs);
    return `on ${date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`;
  }
  if (hours > 0) {
    return `in ${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `in ${minutes}m`;
  }
  return "expiring soon";
}

export interface HubConnectionStatusProps {
  /** The currently-selected auth method from the form (may differ from persisted config). */
  authMethod?: HubAuthMethod;
}

export const HubConnectionStatus: React.FC<HubConnectionStatusProps> = ({ authMethod: authMethodProp }) => {
  const solutionServerConnected = useExtensionStore((s) => s.solutionServerConnected);
  const profileSyncConnected = useExtensionStore((s) => s.profileSyncConnected);
  const llmProxyAvailable = useExtensionStore((s) => s.llmProxyAvailable);
  const oidcUsername = useExtensionStore((s) => s.oidcUsername);
  const oidcTokenExpiry = useExtensionStore((s) => s.oidcTokenExpiry);
  const hubConnectionError = useExtensionStore((s) => s.hubConnectionError);
  const hubConfig = useExtensionStore((s) => s.hubConfig);

  // Force re-render every 60s so token expiry stays fresh
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!oidcTokenExpiry) return;
    const interval = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(interval);
  }, [oidcTokenExpiry]);

  const isConnected = solutionServerConnected || profileSyncConnected || llmProxyAvailable;
  const isHubEnabled = hubConfig?.enabled ?? false;
  // Prefer the prop (form's live state) over the persisted store value
  const authMethod: HubAuthMethod = authMethodProp ?? hubConfig?.auth?.method ?? "oidc";
  const isOidc = authMethod === "oidc";
  const persistedMethod = hubConfig?.auth?.method ?? "oidc";
  const authMethodChanged = !!authMethodProp && authMethodProp !== persistedMethod;
  // Authentication is confirmed if we have OIDC identity info OR if Hub features are
  // already connected — but not if the user switched auth methods without saving yet.
  const isAuthenticated = !authMethodChanged && !!(oidcUsername || oidcTokenExpiry || isConnected);

  const handleSignOut = () => {
    dispatch({ type: "HUB_OIDC_LOGOUT", payload: {} });
  };

  const handleReconnect = () => {
    dispatch({ type: "HUB_RECONNECT", payload: {} });
  };

  return (
    <Card isCompact style={{ marginBottom: "1rem" }}>
      <CardBody>
        <Split hasGutter>
          <SplitItem>
            <Label
              color={isAuthenticated ? "green" : "red"}
              icon={
                isAuthenticated ? <CheckCircleIcon /> : <DisconnectedIcon />
              }
            >
              {isAuthenticated ? "Connected" : "Disconnected"}
            </Label>
          </SplitItem>

          {isAuthenticated && oidcUsername && (
            <SplitItem>
              <Content component={ContentVariants.small}>
                Signed in as <strong>{oidcUsername}</strong>
              </Content>
            </SplitItem>
          )}

          {isAuthenticated && oidcTokenExpiry && (
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

          {isAuthenticated && isOidc && (
            <SplitItem>
              <Button variant="secondary" isDanger onClick={handleSignOut}>
                Sign Out
              </Button>
            </SplitItem>
          )}

          {!isAuthenticated && isHubEnabled && !authMethodChanged && (
            <SplitItem>
              <Button variant="primary" onClick={handleReconnect}>
                Sign In
              </Button>
            </SplitItem>
          )}
        </Split>

        {/* Guidance text when disconnected or auth method changed */}
        {isHubEnabled && authMethodChanged && (
          <Content component={ContentVariants.small} style={{ marginTop: "0.75rem", color: "var(--pf-v5-global--Color--200)" }}>
            Authentication method changed. Save to reconnect.
          </Content>
        )}
        {isHubEnabled && !isAuthenticated && !authMethodChanged && (
          <Content component={ContentVariants.small} style={{ marginTop: "0.75rem", color: "var(--pf-v5-global--Color--200)" }}>
            {isOidc
              ? "Click \"Sign In\" above to authenticate via your browser."
              : "Configure credentials below, then click \"Sign In\" to connect."}
          </Content>
        )}
        {hubConnectionError && !authMethodChanged && (
          <HelperText style={{ marginTop: "0.5rem" }}>
            <HelperTextItem icon={<ExclamationCircleIcon />} variant="error">
              {hubConnectionError}
            </HelperTextItem>
          </HelperText>
        )}

        {/* Feature-level status chips */}
        {isHubEnabled && (
          <Flex style={{ marginTop: "0.75rem", gap: "0.5rem" }}>
            <FlexItem>
              <Label
                color={!authMethodChanged && solutionServerConnected ? "green" : "grey"}
                icon={
                  !authMethodChanged && solutionServerConnected ? <CheckCircleIcon /> : <ExclamationCircleIcon />
                }
                isCompact
              >
                Solution Server
              </Label>
            </FlexItem>
            <FlexItem>
              <Label
                color={!authMethodChanged && profileSyncConnected ? "green" : "grey"}
                icon={
                  !authMethodChanged && profileSyncConnected ? <CheckCircleIcon /> : <ExclamationCircleIcon />
                }
                isCompact
              >
                Profile Sync
              </Label>
            </FlexItem>
            <FlexItem>
              <Label
                color={!authMethodChanged && llmProxyAvailable ? "green" : "grey"}
                icon={!authMethodChanged && llmProxyAvailable ? <CheckCircleIcon /> : <ExclamationCircleIcon />}
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
