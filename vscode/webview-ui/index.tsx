import "@patternfly/patternfly/patternfly.css";
import "./index.css"; // Add this line

import React from "react";
import { createRoot } from "react-dom/client";

// Component import
import App from "./components/App";

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
