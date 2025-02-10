// App.tsx
import React, { useState, useEffect } from "react";
import { viewType } from "./utils/vscode";
import AnalysisPage from "./components/AnalysisPage/AnalysisPage";
import { WebviewType } from "@editor-extensions/shared";
import ChatPage from "./components/ChatPage/ChatPage";

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<WebviewType>(viewType);

  useEffect(() => {
    // Update the view when viewType changes
    setCurrentView(viewType);
  }, [viewType]);

  return (
    <div>
      {currentView === "chat" && <ChatPage />}
      {/* {currentView === "resolution" && <ResolutionPage />} */}
    </div>
  );
};

export default App;
