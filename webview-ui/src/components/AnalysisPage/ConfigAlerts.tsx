import React from "react";
import { Alert, AlertActionLink, PageSection, Card } from "@patternfly/react-core";
import { ConfigError } from "@editor-extensions/shared";
import { restartSolutionServer, enableGenAI } from "../../hooks/actions";

interface ConfigAlertsProps {
  configErrors: ConfigError[];
  solutionServerEnabled: boolean;
  solutionServerConnected: boolean;
  onOpenProfileManager: () => void;
  dispatch: (action: any) => void;
}

const ConfigAlerts: React.FC<ConfigAlertsProps> = ({
  configErrors,
  solutionServerEnabled,
  solutionServerConnected,
  onOpenProfileManager,
  dispatch,
}) => {
  // Don't render anything if there are no alerts to show
  if (configErrors.length === 0 && !solutionServerEnabled) {
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
