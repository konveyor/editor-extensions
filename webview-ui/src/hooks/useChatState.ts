import { useEffect, useRef } from "react";
import { useChatMessages } from "./useChatMessages";
import { useExtensionState } from "./useExtensionState";
import { runAnalysis, startServer, stopServer } from "./actions";
import { useViolations } from "./useViolations";
import { QuickStart } from "@patternfly/chatbot/dist/cjs/Message/QuickStarts/types";
import { Solution, SolutionResponse, GetSolutionResult, Scope } from "@editor-extensions/shared";

type ChatState = "idle" | "starting" | "ready" | "analyzing" | "analyzed" | "solving";

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
    isFetchingSolution,
    ruleSets: analysisResults,
    solutionData,
    solutionScope,
    solutionState,
  } = state;

  const violations = useViolations(analysisResults);
  const serverRunning = serverState === "running";

  // Track the last solution we've shown to prevent re-rendering
  const lastShownSolutionRef = useRef<string | null>(null);

  // Track whether we've shown the initial ready message
  const readyMessageShownRef = useRef(false);

  // Track whether we've shown the solution loading message
  const solutionLoadingShownRef = useRef(false);

  const formatSolutionMessage = (solution: Solution, scope: Scope) => {
    const { incidents, effortLevel } = scope;

    let message = `Generated ${effortLevel} effort solution for ${incidents.length} incident${incidents.length > 1 ? "s" : ""}\n\n`;

    if ("changes" in solution) {
      const result = solution as GetSolutionResult;
      message += `Changes required in ${result.changes.length} file${result.changes.length > 1 ? "s" : ""}\n`;

      if (result.encountered_errors.length > 0) {
        message += `\nEncountered ${result.encountered_errors.length} error${result.encountered_errors.length > 1 ? "s" : ""}:\n`;
        result.encountered_errors.forEach((error) => {
          message += `- ${error}\n`;
        });
      }
    } else {
      const response = solution as SolutionResponse;
      message += `Modified ${response.modified_files.length} file${response.modified_files.length > 1 ? "s" : ""}\n`;

      if (response.encountered_errors.length > 0) {
        message += `\nEncountered ${response.encountered_errors.length} error${response.encountered_errors.length > 1 ? "s" : ""}:\n`;
        response.encountered_errors.forEach((error) => {
          message += `- ${error}\n`;
        });
      }
    }

    return message;
  };

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
    if (isFetchingSolution) {
      return "solving";
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
        disabled: !serverRunning,
      },
    ];

    if (analysisResults) {
      responses.unshift({
        id: "view-analysis",
        content: "View analysis results",
        onClick: () => handleAction("View analysis"),
        disabled: !serverRunning,
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
      readyMessageShownRef.current = false;
      solutionLoadingShownRef.current = false;
      lastShownSolutionRef.current = null;
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

  // Effect for handling server ready state
  useEffect(() => {
    if (
      serverRunning &&
      !isStartingServer &&
      !readyMessageShownRef.current
      //   messages.length === 0
    ) {
      readyMessageShownRef.current = true;
      addMessage({
        name: "Kai",
        role: "bot",
        content: "What would you like to do?",
        avatar: avatarImg,
        quickResponses: getQuickResponses(),
      });
    }
  }, [serverRunning, isStartingServer, messages.length]);

  // Effect for handling analysis state
  useEffect(() => {
    if (isAnalyzing) {
      const lastMessage = messages[messages.length - 1];
      if (!lastMessage?.content.includes("Starting analysis")) {
        addMessage({
          name: "Kai",
          role: "bot",
          content: "Starting analysis process...",
          avatar: avatarImg,
        });
      }
    } else if (!isAnalyzing && analysisResults) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.content.includes("Starting analysis")) {
        const summaryContent =
          violations.length === 0
            ? "No violations were found in the analysis. Great job!"
            : `Found ${violations.length} violation type${violations.length > 1 ? "s" : ""} with a total of ${violations.reduce((total, v) => total + v.incidents.length, 0)} incident${violations.length > 1 ? "s" : ""}.`;

        addMessage({
          name: "Kai",
          role: "bot",
          content: summaryContent,
          avatar: avatarImg,
          quickStart: getAnalysisSummaryQuickStart(),
        });

        addMessage({
          name: "Kai",
          role: "bot",
          content: "What would you like to do next?",
          avatar: avatarImg,
          quickResponses: getQuickResponses(),
        });
      }
    }
  }, [isAnalyzing, analysisResults]);

  // Effect for handling solution state
  useEffect(() => {
    if (isFetchingSolution && !solutionLoadingShownRef.current) {
      solutionLoadingShownRef.current = true;
      addMessage({
        name: "Kai",
        role: "bot",
        content: "Generating solution...",
        avatar: avatarImg,
        loading: true,
      });
    } else if (!isFetchingSolution) {
      solutionLoadingShownRef.current = false;
    }

    if (solutionState === "received" && solutionData && solutionScope) {
      const solutionId = JSON.stringify(solutionData);
      if (lastShownSolutionRef.current !== solutionId) {
        lastShownSolutionRef.current = solutionId;
        const solutionMessage = formatSolutionMessage(solutionData, solutionScope);

        addMessage({
          name: "Kai",
          role: "bot",
          content: solutionMessage,
          avatar: avatarImg,
        });

        addMessage({
          name: "Kai",
          role: "bot",
          content: "What would you like to do next?",
          avatar: avatarImg,
          quickResponses: getQuickResponses(),
        });
      }
    }
  }, [isFetchingSolution, solutionState, solutionData, solutionScope]);

  const getAnalysisSummaryQuickStart = (): QuickStart | undefined => {
    if (violations.length === 0) {
      return undefined;
    }

    const totalIncidents = violations.reduce(
      (total, violation) => total + violation.incidents.length,
      0,
    );

    return {
      apiVersion: "console.openshift.io/v1",
      kind: "QuickStart",
      metadata: {
        name: "analysis-summary",
      },
      spec: {
        version: 1,
        displayName: "Analysis Results",
        icon: undefined,
        description: "Review analysis results and detected violations",
        prerequisites: [`${totalIncidents} total incidents to review`],
        introduction: "This analysis has identified potential issues that need attention.",
        tasks: violations.map((violation) => ({
          title: violation?.description,
          description: `Found ${violation?.incidents?.length} incident(s)`,
        })),
        conclusion: "Review complete. Take necessary actions to address identified issues.",
      },
    };
  };

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
