import React, { useState } from "react";
import {
  Alert,
  AlertActionLink,
  AlertActionCloseButton,
  PageSection,
  Card,
} from "@patternfly/react-core";
import { ConfigError } from "@editor-extensions/shared";
import type { LLMError } from "@editor-extensions/shared";
import {
  restartSolutionServer,
  enableGenAI,
  retryProfileSync,
  syncHubProfiles,
} from "../../hooks/actions";

interface ConfigAlertsProps {
  configErrors: ConfigError[];
  llmErrors?: LLMError[];
  solutionServerEnabled: boolean;
  solutionServerConnected: boolean;
  profileSyncEnabled: boolean;
  profileSyncConnected: boolean;
  onOpenProfileManager: () => void;
  dispatch: (action: any) => void;
  onDismissLLMError?: (timestamp: string) => void;
}

const ConfigAlerts: React.FC<ConfigAlertsProps> = ({
  configErrors,
  llmErrors = [],
  solutionServerEnabled,
  solutionServerConnected,
  profileSyncEnabled,
  profileSyncConnected,
  onOpenProfileManager,
  dispatch,
  onDismissLLMError,
}) => {
  const [dismissedNoHubProfiles, setDismissedNoHubProfiles] = useState(false);
  const [dismissedHubProfileSyncFailed, setDismissedHubProfileSyncFailed] = useState(false);

  // Separate hub profile errors from other config errors
  const noHubProfilesError = configErrors.find((e) => e.type === "no-hub-profiles");
  const hubProfileSyncFailedError = configErrors.find((e) => e.type === "hub-profile-sync-failed");
  const otherConfigErrors = configErrors.filter(
    (e) => e.type !== "no-hub-profiles" && e.type !== "hub-profile-sync-failed",
  );

  // Don't render anything if there are no alerts to show
  // Show alerts if: config errors exist OR llm errors exist OR (solution server enabled AND disconnected) OR (profile sync enabled AND disconnected)
  const shouldShowAlerts =
    configErrors.length > 0 ||
    llmErrors.length > 0 ||
    (solutionServerEnabled && !solutionServerConnected) ||
    (profileSyncEnabled && !profileSyncConnected);

  if (!shouldShowAlerts) {
    return null;
  }

  return (
    <>
      {/* Regular config errors (excluding no-hub-profiles) */}
      {otherConfigErrors.length > 0 && (
        <PageSection padding={{ default: "noPadding" }}>
          {otherConfigErrors.map((error, index) => (
            <Card
              isCompact
              style={{ maxWidth: "600px", margin: "1rem auto 1rem auto" }}
              key={index}
            >
              <Alert
                variant="warning"
                title={error.message}
                actionLinks={
                  error.type === "no-active-profile" ? (
                    <AlertActionLink onClick={onOpenProfileManager}>
                      Manage Profiles
                    </AlertActionLink>
                  ) : error.type === "genai-disabled" ? (
                    <AlertActionLink onClick={() => dispatch(enableGenAI())}>
                      Enable GenAI
                    </AlertActionLink>
                  ) : undefined
                }
              >
                {error.error ?? ""}
              </Alert>
            </Card>
          ))}
        </PageSection>
      )}

      {/* No Hub profiles info alert (dismissable with retry) */}
      {noHubProfilesError && !dismissedNoHubProfiles && (
        <PageSection padding={{ default: "noPadding" }}>
          <Card isCompact style={{ maxWidth: "600px", margin: "1rem auto 1rem auto" }}>
            <Alert
              variant="info"
              title={noHubProfilesError.message}
              actionLinks={
                <AlertActionLink onClick={() => dispatch(syncHubProfiles())}>
                  Retry Sync
                </AlertActionLink>
              }
              actionClose={
                <AlertActionCloseButton onClose={() => setDismissedNoHubProfiles(true)} />
              }
            >
              {noHubProfilesError.error}
            </Alert>
          </Card>
        </PageSection>
      )}

      {/* Hub profile sync failed warning alert (dismissable with retry) */}
      {hubProfileSyncFailedError && !dismissedHubProfileSyncFailed && (
        <PageSection padding={{ default: "noPadding" }}>
          <Card isCompact style={{ maxWidth: "600px", margin: "1rem auto 1rem auto" }}>
            <Alert
              variant="warning"
              title={hubProfileSyncFailedError.message}
              actionLinks={
                <AlertActionLink onClick={() => dispatch(syncHubProfiles())}>
                  Retry Sync
                </AlertActionLink>
              }
              actionClose={
                <AlertActionCloseButton onClose={() => setDismissedHubProfileSyncFailed(true)} />
              }
            >
              {hubProfileSyncFailedError.error}
            </Alert>
          </Card>
        </PageSection>
      )}

      {/* LLM errors */}
      {llmErrors.length > 0 && (
        <PageSection padding={{ default: "noPadding" }}>
          {llmErrors.map((error) => (
            <Card
              isCompact
              style={{ maxWidth: "600px", margin: "1rem auto 1rem auto" }}
              key={error.timestamp}
            >
              <Alert
                variant="danger"
                title={error.message}
                actionClose={
                  onDismissLLMError ? (
                    <AlertActionCloseButton onClose={() => onDismissLLMError(error.timestamp)} />
                  ) : undefined
                }
              >
                {error.error && (
                  <details style={{ marginTop: "8px" }}>
                    <summary style={{ cursor: "pointer" }}>Technical details</summary>
                    <pre
                      style={{
                        fontSize: "12px",
                        whiteSpace: "pre-wrap",
                        marginTop: "8px",
                        padding: "8px",
                        backgroundColor: "#f5f5f5",
                        borderRadius: "4px",
                      }}
                    >
                      {error.error}
                    </pre>
                  </details>
                )}
              </Alert>
            </Card>
          ))}
        </PageSection>
      )}

      {/* Solution server connection status */}
      {solutionServerEnabled && (
        <PageSection padding={{ default: "noPadding" }}>
          <Card isCompact style={{ maxWidth: "600px", margin: "1rem auto 1rem auto" }}>
            {solutionServerConnected ? null : (
              <Alert
                variant="warning"
                title="Solution Server Disconnected"
                actionLinks={
                  <AlertActionLink onClick={() => dispatch(restartSolutionServer())}>
                    Retry Connection
                  </AlertActionLink>
                }
              >
                The solution server is enabled but not connected. AI-powered solution suggestions
                may not work properly.
              </Alert>
            )}
          </Card>
        </PageSection>
      )}

      {/* Profile sync connection status */}
      {profileSyncEnabled && (
        <PageSection padding={{ default: "noPadding" }}>
          <Card isCompact style={{ maxWidth: "600px", margin: "1rem auto 1rem auto" }}>
            {profileSyncConnected ? null : (
              <Alert
                variant="warning"
                title="Profile Sync Disconnected"
                actionLinks={
                  <AlertActionLink onClick={() => dispatch(retryProfileSync())}>
                    Retry Connection
                  </AlertActionLink>
                }
              >
                Profile sync is enabled but not connected. Profiles will not automatically sync from
                the Hub.
              </Alert>
            )}
          </Card>
        </PageSection>
      )}
    </>
  );
};

export default ConfigAlerts;
