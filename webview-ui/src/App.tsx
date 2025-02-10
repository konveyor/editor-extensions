// App.tsx
import React, { useState, useEffect } from "react";
import { viewType } from "./utils/vscode";
import AnalysisPage from "./components/AnalysisPage/AnalysisPage";
import ResolutionPage from "./components/ResolutionsPage/ResolutionsPage";
import { WebviewType } from "@editor-extensions/shared";

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<WebviewType>(viewType);

  useEffect(() => {
    // Update the view when viewType changes
    setCurrentView(viewType);
  }, [viewType]);

  return (
    <div>
      {currentView === "chat" && <ChatPage />}
      {currentView === "resolution" && <ResolutionPage />}
    </div>
  );
};

export default App;
