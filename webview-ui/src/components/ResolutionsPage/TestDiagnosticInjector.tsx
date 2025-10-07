import React from "react";
import { Button } from "@patternfly/react-core";
import { ChatMessage, ChatMessageType, DiagnosticSummary } from "@editor-extensions/shared";

interface TestDiagnosticInjectorProps {
  onInjectMessage: (message: ChatMessage) => void;
}

export const TestDiagnosticInjector: React.FC<TestDiagnosticInjectorProps> = ({
  onInjectMessage,
}) => {
  const createTestDiagnosticMessage = (): ChatMessage => {
    // Create a sample diagnostic summary with multiple files and issues
    const diagnosticSummary: DiagnosticSummary = {
      summary: "Found 8 migration issues across 4 files",
      totalIssues: 8,
      issuesByFile: {
        "src/main/java/com/acme/UserService.java": [
          {
            id: "issue-1",
            message: "The import javax.ejb.Stateless is never used",
            uri: "src/main/java/com/acme/UserService.java",
            filename: "UserService.java",
          },
          {
            id: "issue-2",
            message: "Replace javax.ejb.Stateless with jakarta.ejb.Stateless",
            uri: "src/main/java/com/acme/UserService.java",
            filename: "UserService.java",
          },
          {
            id: "issue-3",
            message: "Method 'getUserById' may return null but is not annotated with @Nullable",
            uri: "src/main/java/com/acme/UserService.java",
            filename: "UserService.java",
          },
        ],
        "src/main/java/com/acme/config/DatabaseConfig.java": [
          {
            id: "issue-4",
            message:
              "Replace javax.persistence.EntityManager with jakarta.persistence.EntityManager",
            uri: "src/main/java/com/acme/config/DatabaseConfig.java",
            filename: "DatabaseConfig.java",
          },
          {
            id: "issue-5",
            message: "Deprecated API usage: Use DataSource.getConnection() instead",
            uri: "src/main/java/com/acme/config/DatabaseConfig.java",
            filename: "DatabaseConfig.java",
          },
        ],
        "src/main/webapp/WEB-INF/web.xml": [
          {
            id: "issue-6",
            message: "Update servlet version from 3.1 to 4.0 in web.xml",
            uri: "src/main/webapp/WEB-INF/web.xml",
            filename: "web.xml",
          },
          {
            id: "issue-7",
            message: "Remove deprecated security-constraint element",
            uri: "src/main/webapp/WEB-INF/web.xml",
            filename: "web.xml",
          },
        ],
        "pom.xml": [
          {
            id: "issue-8",
            message: "Update dependency: javax.servlet-api to jakarta.servlet-api version 5.0.0",
            uri: "pom.xml",
            filename: "pom.xml",
          },
        ],
      },
    };

    return {
      kind: ChatMessageType.Diagnostic,
      value: {
        message:
          "I've completed the analysis of your codebase. Here are the migration issues I found:",
        diagnosticSummary,
      },
      messageToken: `test-diagnostic-${Date.now()}`,
      timestamp: new Date().toISOString(),
      quickResponses: [
        {
          id: "yes",
          content: "Yes, fix selected",
          isDisabled: false,
        },
        {
          id: "no",
          content: "No, skip for now",
          isDisabled: false,
        },
      ],
    };
  };

  const handleInjectMessage = () => {
    const testMessage = createTestDiagnosticMessage();
    onInjectMessage(testMessage);
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: "20px",
        right: "20px",
        zIndex: 9999,
        background: "var(--pf-global--BackgroundColor--100)",
        padding: "8px",
        borderRadius: "4px",
        boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
      }}
    >
      <Button variant="danger" size="sm" onClick={handleInjectMessage}>
        🧪 Inject Test Diagnostic
      </Button>
    </div>
  );
};

export default TestDiagnosticInjector;
