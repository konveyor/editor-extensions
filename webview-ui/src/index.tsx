import "@patternfly/patternfly/patternfly.css";
import "./index.css"; // Add this line

import { createRoot } from "react-dom/client";
import App from "./App";
import React from "react";

// Component import

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
