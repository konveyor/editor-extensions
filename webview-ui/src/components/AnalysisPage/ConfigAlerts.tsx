import React from "react";
import {
  Alert,
  AlertActionLink,
  AlertActionCloseButton,
  PageSection,
  Card,
} from "@patternfly/react-core";
import { ConfigError } from "@editor-extensions/shared";
import type { LLMError } from "@editor-extensions/shared";
import { restartSolutionServer, enableGenAI } from "../../hooks/actions";

interface ConfigAlertsProps {
  configErrors: ConfigError[];
  llmErrors?: LLMError[];
  solutionServerEnabled: boolean;
  solutionServerConnected: boolean;
  onOpenProfileManager: () => void;
  dispatch: (action: any) => void;
  onDismissLLMError?: (timestamp: string) => void;
}

const ConfigAlerts: React.FC<ConfigAlertsProps> = ({
  configErrors,
  llmErrors = [],
  solutionServerEnabled,
  solutionServerConnected,
  onOpenProfileManager,
  dispatch,
  onDismissLLMError,
}) => {
  // Don't render anything if there are no alerts to show
  // Show alerts if: config errors exist OR llm errors exist OR (solution server enabled AND disconnected)
  const shouldShowAlerts =
    configErrors.length > 0 ||
    llmErrors.length > 0 ||
    (solutionServerEnabled && !solutionServerConnected);

  if (!shouldShowAlerts) {
    return null;
  }

  return (
    <>
      {/* Regular config errors */}
      {configErrors.length > 0 && (
        <PageSection padding={{ default: "noPadding" }}>
          {configErrors.map((error, index) => (
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
    </>
  );
};

export default ConfigAlerts;
