import React, { useState } from "react";
import { Incident } from "@editor-extensions/shared";
import { useChatState } from "./hooks/useChatState";
import { useExtensionState } from "./hooks/useExtensionState";
import { getSolution, openFile } from "./hooks/actions";
import { useViolations } from "./hooks/useViolations";
import { ChatPage } from "./components/ChatPage/ChatPage";
import { AnalysisOverlay } from "./components/AnalysisOverlay/AnalysisOverlay";

const avatarImg =
  "https://raw.githubusercontent.com/konveyor/tackle2-ui/refs/heads/main/branding/favicon.ico";
const userImg =
  "https://raw.githubusercontent.com/patternfly/patternfly-react/main/packages/react-core/src/components/assets/avatarImg.svg";

function App() {
  const [showAnalysisOverlay, setShowAnalysisOverlay] = useState(false);
  const [state, dispatch] = useExtensionState();
  const {
    isAnalyzing,
    isFetchingSolution: isWaitingForSolution,
    ruleSets: analysisResults,
    enhancedIncidents,
    workspaceRoot,
  } = state;

  const {
    chatState,
    messages,
    isStartingServer,
    isInitializingServer,
    serverRunning,
    handleServerToggle,
  } = useChatState({
    avatarImg,
    userImg,
    onShowAnalysis: () => setShowAnalysisOverlay(true),
  });

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [focusedIncident, setFocusedIncident] = useState<Incident | null>(null);
  const [expandedViolations, setExpandedViolations] = useState<Set<string>>(new Set());

  const handleIncidentSelect = (incident: Incident) => {
    setFocusedIncident(incident);
    dispatch(openFile(incident.uri, incident.lineNumber ?? 0));
  };

  const violations = useViolations(analysisResults);
  const hasAnalysisResults = analysisResults !== undefined;

  if (showAnalysisOverlay) {
    return (
      <AnalysisOverlay
        onClose={() => {
          console.log("onClose");
          setShowAnalysisOverlay(false);
        }}
        errorMessage={errorMessage}
        setErrorMessage={setErrorMessage}
        isAnalyzing={isAnalyzing}
        isWaitingForSolution={isWaitingForSolution}
        violations={violations}
        hasAnalysisResults={hasAnalysisResults}
        workspaceRoot={workspaceRoot}
        serverRunning={serverRunning}
        enhancedIncidents={enhancedIncidents}
        focusedIncident={focusedIncident}
        onIncidentSelect={handleIncidentSelect}
        dispatch={dispatch}
        getSolution={getSolution}
        expandedViolations={expandedViolations}
        setExpandedViolations={setExpandedViolations}
      />
    );
  }

  return (
    <ChatPage
      messages={messages}
      chatState={chatState}
      serverRunning={serverRunning}
      isStartingServer={isStartingServer}
      isInitializingServer={isInitializingServer}
      handleServerToggle={handleServerToggle}
      setShowAnalysisOverlay={setShowAnalysisOverlay}
    />
  );
}

export default App;
