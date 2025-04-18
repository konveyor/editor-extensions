// App.tsx
import React, { useState, useEffect } from "react";
import { viewType } from "./utils/vscode";
import AnalysisPage from "./components/AnalysisPage/AnalysisPage";
import ResolutionPage from "./components/ResolutionsPage/ResolutionsPage";
import { WebviewType } from "@editor-extensions/shared";
import { ExtensionStateProvider } from "./context/ExtensionStateContext";
import { ProfileManagerPage } from "./components/ProfileManager/ProfileManagerPage";

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<WebviewType>(viewType);

  useEffect(() => {
    // Update the view when viewType changes
    setCurrentView(viewType);
  }, [viewType]);

  return (
    <div>
      <ExtensionStateProvider>
        {currentView === "sidebar" && <AnalysisPage />}
        {currentView === "resolution" && <ResolutionPage />}
        {currentView === "profiles" && <ProfileManagerPage />}
      </ExtensionStateProvider>
    </div>
  );
};

export default App;
