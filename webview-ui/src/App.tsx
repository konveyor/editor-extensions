// App.tsx
import React, { useState, useEffect } from "react";
import { viewType } from "./utils/vscode";
import AnalysisPage from "./components/AnalysisPage";
import ResolutionPage from "./components/ResolutionsPage";

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<string>(viewType);

  useEffect(() => {
    // Update the view when viewType changes
    setCurrentView(viewType);
  }, [viewType]);

  return (
    <div>
      {currentView === "sidebar" && <AnalysisPage />}
      {currentView === "resolution" && <ResolutionPage />}
    </div>
  );
};

export default App;
