import { useEffect } from "react";
import { useChatMessages } from "./useChatMessages";
import { useExtensionState } from "./useExtensionState";
import { runAnalysis, startServer, stopServer } from "./actions";

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
      addMessage({
        name: "Kai",
        role: "bot",
        content: "Analysis complete! What would you like to do next?",
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
