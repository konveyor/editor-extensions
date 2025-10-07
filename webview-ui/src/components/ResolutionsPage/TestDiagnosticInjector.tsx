import React, { useState } from "react";
import {
  Dropdown,
  DropdownList,
  DropdownItem,
  MenuToggle,
  MenuToggleElement,
} from "@patternfly/react-core";
import { ChatMessage, ChatMessageType, DiagnosticSummary } from "@editor-extensions/shared";

interface TestDiagnosticInjectorProps {
  onInjectMessage: (message: ChatMessage) => void;
}

export const TestDiagnosticInjector: React.FC<TestDiagnosticInjectorProps> = ({
  onInjectMessage,
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

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

  const createTestStringMessage = (): ChatMessage => {
    return {
      kind: ChatMessageType.String,
      value: {
        message: "This is a test string message. It can contain **markdown** formatting and links.",
      },
      messageToken: `test-string-${Date.now()}`,
      timestamp: new Date().toISOString(),
      quickResponses: [
        {
          id: "continue",
          content: "Continue",
          isDisabled: false,
        },
        {
          id: "stop",
          content: "Stop",
          isDisabled: false,
        },
      ],
    };
  };

  const createTestToolMessage = (): ChatMessage => {
    const statuses = ["running", "succeeded", "failed"];
    const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];

    return {
      kind: ChatMessageType.Tool,
      value: {
        toolName: "analyze_codebase",
        toolStatus: randomStatus,
        toolOutput: randomStatus === "failed" ? "Error: Test failure message" : undefined,
      },
      messageToken: `test-tool-${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
  };

  // const createTestModifiedFileMessage = (): ChatMessage => {
  //   return {
  //     kind: ChatMessageType.ModifiedFile,
  //     value: {
  //       filename: "src/main/java/com/example/TestService.java",
  //       uri: "src/main/java/com/example/TestService.java",
  //       changes: [
  //         {
  //           lineNumber: 15,
  //           description: "Replace javax.inject with jakarta.inject",
  //           original: "import javax.inject.Inject;",
  //           modified: "import jakarta.inject.Inject;",
  //         },
  //         {
  //           lineNumber: 42,
  //           description: "Update EJB annotation",
  //           original: "@javax.ejb.Stateless",
  //           modified: "@jakarta.ejb.Stateless",
  //         },
  //       ],
  //     },
  //     messageToken: `test-modified-${Date.now()}`,
  //     timestamp: new Date().toISOString(),
  //   };
  // };

  const createTestAnalysisMessage = (): ChatMessage => {
    return {
      kind: ChatMessageType.String,
      value: {
        message: "Starting analysis of your codebase...",
      },
      messageToken: `test-analysis-${Date.now()}`,
      timestamp: new Date().toISOString(),
      quickResponses: [
        {
          id: "run-analysis",
          content: "Run Analysis",
          isDisabled: false,
        },
      ],
    };
  };

  const handleInjectMessage = (type: string) => {
    let testMessage: ChatMessage;

    switch (type) {
      case "diagnostic":
        testMessage = createTestDiagnosticMessage();
        break;
      case "string":
        testMessage = createTestStringMessage();
        break;
      case "tool":
        testMessage = createTestToolMessage();
        break;
      // case "modifiedFile":
      //   testMessage = createTestModifiedFileMessage();
      //   break;
      case "analysis":
        testMessage = createTestAnalysisMessage();
        break;
      default:
        testMessage = createTestDiagnosticMessage();
    }

    onInjectMessage(testMessage);
    setIsDropdownOpen(false);
  };

  const onToggleClick = () => {
    setIsDropdownOpen(!isDropdownOpen);
  };

  const onSelect = (
    _event: React.MouseEvent<Element, MouseEvent> | undefined,
    value: string | number | undefined,
  ) => {
    if (typeof value === "string") {
      handleInjectMessage(value);
    }
    setIsDropdownOpen(false);
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
      <Dropdown
        isOpen={isDropdownOpen}
        onSelect={onSelect}
        onOpenChange={(isOpen: boolean) => setIsDropdownOpen(isOpen)}
        toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
          <MenuToggle
            ref={toggleRef}
            onClick={onToggleClick}
            isExpanded={isDropdownOpen}
            variant="primary"
          >
            🧪 Inject Test Message
          </MenuToggle>
        )}
        popperProps={{
          position: "right",
          appendTo: () => document.body,
          enableFlip: true,
        }}
      >
        <DropdownList>
          <DropdownItem key="diagnostic" value="diagnostic">
            📊 Diagnostic Message
          </DropdownItem>
          <DropdownItem key="string" value="string">
            💬 String Message
          </DropdownItem>
          <DropdownItem key="tool" value="tool">
            🔧 Tool Message
          </DropdownItem>
          <DropdownItem key="modifiedFile" value="modifiedFile">
            📝 Modified File Message
          </DropdownItem>
          <DropdownItem key="analysis" value="analysis">
            🔍 Analysis Message
          </DropdownItem>
        </DropdownList>
      </Dropdown>
    </div>
  );
};

export default TestDiagnosticInjector;
