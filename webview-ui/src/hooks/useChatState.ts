import { useEffect, useRef, useState } from "react";
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
  // ^-- You’ll need an `updateMessage` helper in useChatMessages (or whichever suits your usage).
  //     If you only have "addMessage" and "clearMessages" you can adapt the logic to your needs.

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

  /**
   * Local refs/states to help manage or avoid repeating messages.
   */
  const serverStartMsgIdRef = useRef<string | null>(null);
  const [analysisResultsShown, setAnalysisResultsShown] = useState(false);

  /**
   * Format the solution message to be displayed in the chat.
   */
  const formatSolutionMessage = (solution: Solution, scope: Scope) => {
    const { incidents, effortLevel } = scope;
    let message = `Generated ${effortLevel} effort solution for ${incidents.length} incident${
      incidents.length > 1 ? "s" : ""
    }\n\n`;

    if ("changes" in solution) {
      const result = solution as GetSolutionResult;
      message += `Changes required in ${result.changes.length} file${
        result.changes.length > 1 ? "s" : ""
      }\n`;

      if (result.encountered_errors.length > 0) {
        message += `\nEncountered ${result.encountered_errors.length} error${
          result.encountered_errors.length > 1 ? "s" : ""
        }:\n`;
        result.encountered_errors.forEach((error) => {
          message += `- ${error}\n`;
        });
      }
    } else {
      const response = solution as SolutionResponse;
      message += `Modified ${response.modified_files.length} file${
        response.modified_files.length > 1 ? "s" : ""
      }\n`;

      if (response.encountered_errors.length > 0) {
        message += `\nEncountered ${response.encountered_errors.length} error${
          response.encountered_errors.length > 1 ? "s" : ""
        }:\n`;
        response.encountered_errors.forEach((error) => {
          message += `- ${error}\n`;
        });
      }
    }

    return message;
  };

  /**
   * Determine which high-level "chat state" we are in:
   */
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
    // Only “analyzed” if we have results from the server.
    if (analysisResults) {
      return "analyzed";
    }
    return "ready";
  };

  /**
   * Returns the set of quick responses to be displayed at any moment.
   */
  const getQuickResponses = () => {
    const responses = [
      {
        id: "run-analysis",
        content: "Run analysis",
        onClick: () => handleAction("Run analysis"),
        disabled: !serverRunning,
      },
    ];

    // If we have analysis results, add the "View analysis results" to the top
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

  /**
   * Handle user-initiated actions (buttons in the chat).
   */
  const handleAction = async (action: string) => {
    if (action === "View analysis") {
      onShowAnalysis();
      return;
    }

    // Add the user’s message to the chat
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

  /**
   * Toggling the server on or off.
   *
   * - If the server is not running and we’re not already starting it,
   *   clear the chat and show a “Starting server” message.
   * - If the server is running, stop it.
   */
  const handleServerToggle = () => {
    if (!serverRunning && !isStartingServer) {
      clearMessages();
      dispatch(startServer());
      const msgId = addMessage({
        name: "Kai",
        role: "bot",
        content: "Starting the server...",
        avatar: avatarImg,
      });
      //   serverStartMsgIdRef.current = msgId;
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

  /**
   * Decide if a new message should be added, to avoid spamming the user with repeated states.
   */
  const shouldAddNewMessage = () => {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) {
      return true;
    }

    // If we’re fetching solution, only show loading message if not already shown
    if (isFetchingSolution) {
      return !lastMessage.content.includes("Generating solution");
    }

    // If we’ve received a solution, only show solution result if we haven’t shown it yet
    if (solutionState === "received" && solutionData) {
      return !lastMessage.content.includes("Generated");
    }

    // If analyzing, only show "Starting analysis" if not already displayed
    if (isAnalyzing) {
      return !lastMessage.content.includes("Starting analysis");
    }

    // Don’t add new messages if the last message has quick responses and isn't disabled
    if (lastMessage.role === "bot" && lastMessage.quickResponses && !lastMessage.disabled) {
      return false;
    }

    return true;
  };

  /**
   * Create a QuickStart for the summary of all violations from the analysis.
   */
  const getAnalysisSummaryQuickStart = (): QuickStart | undefined => {
    if (violations.length === 0) {
      return undefined;
    }

    const totalIncidents = violations.reduce((total, v) => total + v.incidents.length, 0);

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

  /**
   * Main effect to handle changes in server/analysis/solution states and orchestrate chat messages.
   */
  useEffect(() => {
    const currentState = getChatState();

    // 1. If the server just transitioned from "starting" to "running," update the chat.
    // if (serverState === "running" && serverStartMsgIdRef.current) {
    //   // Option A: Update the existing “starting the server...” message to “Server is now running.”
    //   updateMessage(serverStartMsgIdRef.current, {
    //     content: "Server is now running.",
    //     quickResponses: getQuickResponses(),
    //   });
    //   serverStartMsgIdRef.current = null; // We’ve updated it, so clear the ref.
    // }

    // 2. If we are “ready” (server running, no analysis done), and the chat is empty, greet the user.
    if (currentState === "ready" && messages.length === 0) {
      addMessage({
        name: "Kai",
        role: "bot",
        content: "What would you like to do?",
        avatar: avatarImg,
        quickResponses: getQuickResponses(),
      });
      return;
    }

    // 3. If we are analyzing and we haven’t displayed a “Starting analysis process...” message yet
    if (currentState === "analyzing" && shouldAddNewMessage()) {
      addMessage({
        name: "Kai",
        role: "bot",
        content: "Starting analysis process...",
        avatar: avatarImg,
      });
      return;
    }

    // 4. If we have analyzed and are not currently analyzing or fetching a solution,
    //    show the analysis results only once (use local state to avoid repeating).
    if (
      currentState === "analyzed" &&
      !isAnalyzing &&
      !isFetchingSolution &&
      !analysisResultsShown
    ) {
      // Mark that we’ve shown the results so we don’t do it again.
      setAnalysisResultsShown(true);

      // Summarize the analysis
      const summaryContent =
        violations.length === 0
          ? "No violations were found in the analysis. Great job!"
          : `Found ${violations.length} violation type${
              violations.length > 1 ? "s" : ""
            } with a total of ${violations.reduce(
              (total, v) => total + v.incidents.length,
              0,
            )} incident${violations.length > 1 ? "s" : ""}.`;

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
      return;
    }

    // 5. If we are generating a solution and have not shown “Generating solution...” yet:
    if (currentState === "solving" && shouldAddNewMessage()) {
      addMessage({
        name: "Kai",
        role: "bot",
        content: "Generating solution...",
        avatar: avatarImg,
      });
      return;
    }

    // 6. If we just received a solution (solutionState === "received") and have solution data,
    //    show it if not shown yet.
    if (solutionState === "received" && solutionData && solutionScope && shouldAddNewMessage()) {
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
      return;
    }
  }, [
    serverState,
    isInitializingServer,
    isAnalyzing,
    analysisResults,
    isFetchingSolution,
    solutionState,
    solutionData,
    solutionScope,
    messages,
    avatarImg,
    violations,
    analysisResultsShown, // local piece of state
  ]);

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
