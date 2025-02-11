import { useEffect } from "react";
import { useChatMessages } from "./useChatMessages";
import { useExtensionState } from "./useExtensionState";
import { runAnalysis, startServer, stopServer } from "./actions";
import { useViolations } from "./useViolations";

type ChatState = "idle" | "starting" | "ready" | "analyzing" | "analyzed";

interface UseChatStateProps {
  avatarImg: string;
  userImg: string;
  onShowAnalysis: () => void;
}

export function useChatState({ avatarImg, userImg, onShowAnalysis }: UseChatStateProps) {
  const [state, dispatch] = useExtensionState();
  const { messages, addMessage, clearMessages } = useChatMessages();

  const {
    isStartingServer,
    isInitializingServer,
    serverState,
    isAnalyzing,
    ruleSets: analysisResults,
  } = state;

  const violations = useViolations(analysisResults);
  const serverRunning = serverState === "running";

  const getChatState = (): ChatState => {
    if (!serverRunning) {
      return "idle";
    }
    if (isStartingServer || isInitializingServer) {
      return "starting";
    }
    if (isAnalyzing) {
      return "analyzing";
    }
    if (analysisResults) {
      return "analyzed";
    }
    return "ready";
  };

  const getQuickResponses = () => {
    const responses = [
      {
        id: "run-analysis",
        content: "Run analysis",
        onClick: () => handleAction("Run analysis"),
      },
    ];

    if (analysisResults) {
      responses.unshift({
        id: "view-analysis",
        content: "View analysis results",
        onClick: () => handleAction("View analysis"),
      });
    }

    return responses;
  };

  const handleAction = async (action: string) => {
    if (action === "View analysis") {
      onShowAnalysis();
      return;
    }

    addMessage({
      name: "User",
      role: "user",
      content: action,
      avatar: userImg,
      disabled: true,
    });

    if (action === "Run analysis") {
      dispatch(runAnalysis());
      addMessage({
        name: "Kai",
        role: "bot",
        content: "Starting analysis process...",
        avatar: avatarImg,
      });
    }
  };

  const handleServerToggle = () => {
    if (!serverRunning && !isStartingServer) {
      clearMessages();
      dispatch(startServer());
      addMessage({
        name: "Kai",
        role: "bot",
        content: "Starting the server...",
        avatar: avatarImg,
      });
    } else if (serverRunning) {
      dispatch(stopServer());
      addMessage({
        name: "Kai",
        role: "bot",
        content: "Server has been stopped.",
        avatar: avatarImg,
      });
    }
  };

  const shouldAddNewMessage = () => {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) {
      return true;
    }

    // Don't add a new message if the last message is from the bot,
    // has quick responses, and isn't disabled
    return !(lastMessage.role === "bot" && lastMessage.quickResponses && !lastMessage.disabled);
  };

  const getAnalysisSummaryQuickStart = () => {
    if (violations.length === 0) {
      return undefined;
    }

    const totalIncidents = violations.reduce(
      (total, violation) => total + violation.incidents.length,
      0,
    );

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
          description: "Review analysis results and detected violations",
          prerequisites: [`${totalIncidents} total incidents to review`],
          introduction: "This analysis has identified potential issues that need attention.",
          tasks: violations.map((violation) => ({
            title: violation.description,
            description: `Found ${violation.incidents.length} incident(s)`,
          })),
          conclusion: "Review complete. Take necessary actions to address identified issues.",
        },
      },
      onSelectQuickStart: () => {}, // QuickStart is used for display only
    };
  };

  // Handle state transitions
  useEffect(() => {
    const currentState = getChatState();

    if (currentState === "ready" && messages.length === 0) {
      addMessage({
        name: "Kai",
        role: "bot",
        content: "What would you like to do?",
        avatar: avatarImg,
        quickResponses: getQuickResponses(),
      });
    } else if (currentState === "analyzed" && !isAnalyzing && shouldAddNewMessage()) {
      // Add analysis summary message
      const summaryContent =
        violations.length === 0
          ? "No violations were found in the analysis. Great job!"
          : `Found ${violations.length} violation type${violations.length > 1 ? "s" : ""} with a total of ${violations.reduce((total, v) => total + v.incidents.length, 0)} incident${violations.length > 1 ? "s" : ""}.`;

      addMessage({
        name: "Kai",
        role: "bot",
        content: summaryContent,
        avatar: avatarImg,
        quickStarts: getAnalysisSummaryQuickStart(),
      });

      // Add action prompt message
      addMessage({
        name: "Kai",
        role: "bot",
        content: "What would you like to do next?",
        avatar: avatarImg,
        quickResponses: getQuickResponses(),
      });
    }
  }, [serverState, isInitializingServer, isAnalyzing, analysisResults]);

  return {
    chatState: getChatState(),
    messages,
    isStartingServer,
    isInitializingServer,
    serverRunning,
    handleServerToggle,
    handleAction,
    getQuickResponses,
  };
}
