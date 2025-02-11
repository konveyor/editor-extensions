import React from "react";
import { Message } from "@patternfly/chatbot";
import { ChatIcon } from "@patternfly/react-icons";
import { Violation, Category, Severity } from "@editor-extensions/shared";

interface AnalysisSummaryProps {
  violations: Violation[];
  avatarImg: string;
  onSelectViolation: (violationId: string) => void;
}

const AnalysisSummary: React.FC<AnalysisSummaryProps> = ({
  violations,
  avatarImg,
  onSelectViolation,
}) => {
  const totalIncidents = violations.reduce(
    (total, violation) => total + violation.incidents.length,
    0,
  );

  const getCategoryLabel = (category?: Category) => {
    switch (category) {
      case "mandatory":
        return "Mandatory";
      case "optional":
        return "Optional";
      case "potential":
        return "Potential";
      default:
        return "Unknown";
    }
  };

  const getSeverityLabel = (severity?: Severity) => {
    return severity || "Unknown";
  };

  const getSummaryContent = () => {
    if (violations.length === 0) {
      return "No violations were found in the analysis. Great job!";
    }

    return `Found ${violations.length} violation type${violations.length > 1 ? "s" : ""} with a total of ${totalIncidents} incident${totalIncidents > 1 ? "s" : ""}.`;
  };

  const getQuickStarts = () => {
    if (violations.length === 0) return undefined;

    return {
      quickStart: {
        apiVersion: "console.openshift.io/v1",
        kind: "QuickStart",
        metadata: {
          name: "analysis-summary",
        },
        spec: {
          version: 1,
          displayName: "Analysis Results",
          durationMinutes: 5,
          icon: <ChatIcon />,
          description: "Review analysis results and detected violations",
          prerequisites: [`${totalIncidents} total incidents to review`],
          introduction: "This analysis has identified potential issues that need attention.",
          tasks: violations.map((violation) => ({
            title: violation.description,
            description: [
              `Category: ${getCategoryLabel(violation.category)}`,
              `Incidents: ${violation.incidents.length}`,
              `Effort Level: ${violation.effort || "Unknown"}`,
              violation.labels?.length ? `Labels: ${violation.labels.join(", ")}` : null,
              "",
              "Incidents:",
              ...violation.incidents
                .map((incident) =>
                  [
                    `• ${incident.message}`,
                    `  Location: ${incident.uri}${incident.lineNumber ? `:${incident.lineNumber}` : ""}`,
                    `  Severity: ${getSeverityLabel(incident.severity)}`,
                    incident.codeSnip ? `  Code: ${incident.codeSnip}` : null,
                  ].filter(Boolean),
                )
                .flat(),
            ]
              .filter(Boolean)
              .join("\n"),
            review: {
              instructions: "Review each incident and determine appropriate action",
              failedTaskHelp: "Contact support if you need assistance understanding this violation",
            },
            summary: {
              success: "You've reviewed all incidents for this violation",
              failed: "Some incidents still need review",
            },
          })),
          conclusion: "Review complete. Take necessary actions to address identified issues.",
          nextQuickStart: [],
        },
      },
      onSelectQuickStart: () => {}, // QuickStart is used for display only
    };
  };

  return (
    <Message
      name="Kai"
      role="bot"
      avatar={avatarImg}
      content={getSummaryContent()}
      quickStarts={getQuickStarts()}
    />
  );
};

export default AnalysisSummary;
