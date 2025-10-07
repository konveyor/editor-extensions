/**
 * Development version of ResolutionsPage with test diagnostic injection.
 * 
 * USAGE:
 * Instead of importing ResolutionPage directly, use this in development:
 * 
 * // In your parent component that renders ResolutionPage:
 * import ResolutionPage from "./ResolutionsPage.dev"; // for development
 * // import ResolutionPage from "./ResolutionsPage"; // for production
 * 
 * This keeps all test code completely separate from production code.
 */

import React, { useState, useCallback, useMemo } from "react";
import { ChatMessage } from "@editor-extensions/shared";
import { useExtensionStateContext } from "../../context/ExtensionStateContext";
import { Page, PageSection, PageSidebar, PageSidebarBody, Title } from "@patternfly/react-core";
import { CheckCircleIcon } from "@patternfly/react-icons";
import { Chatbot, ChatbotContent, ChatbotDisplayMode, MessageBox } from "@patternfly/chatbot";
import LoadingIndicator from "./LoadingIndicator";
import { TestDiagnosticInjector } from "./TestDiagnosticInjector";

// Import the original component to reuse most of its logic
import ResolutionPage from "./ResolutionsPage";

// We'll need to duplicate some of the ResolutionPage logic here to inject test messages
// This is intentional to keep the production code completely clean

const ResolutionPageDev: React.FC = () => {
  const { state } = useExtensionStateContext();
  const [testMessages, setTestMessages] = useState<ChatMessage[]>([]);

  const handleInjectTestMessage = useCallback((message: ChatMessage) => {
    setTestMessages((prev) => [...prev, message]);
  }, []);

  // If we have test messages, we need to render a modified version
  // Otherwise, just render the original
  if (testMessages.length === 0) {
    return (
      <>
        <ResolutionPage />
        <TestDiagnosticInjector onInjectMessage={handleInjectTestMessage} />
      </>
    );
  }

  // When we have test messages, we need to manually merge them with the state
  // This requires us to re-implement the component with modified state
  // This duplication is intentional to keep production code clean
  
  // For now, let's just render a message indicating this needs implementation
  return (
    <Page className="resolutions-page">
      <PageSection>
        <Title headingLevel="h1" size="2xl">
          Development Mode - Test Messages Active
        </Title>
        <p>
          To fully implement test message injection without polluting production code,
          you would need to duplicate the ResolutionPage component logic here and
          modify the chatMessages array to include test messages.
        </p>
        <p>
          Alternatively, consider using a different testing approach such as:
          - Mock data in your development server
          - Browser DevTools to inject messages
          - Separate test harness application
        </p>
      </PageSection>
      <TestDiagnosticInjector onInjectMessage={handleInjectTestMessage} />
    </Page>
  );
};

export default ResolutionPageDev;
