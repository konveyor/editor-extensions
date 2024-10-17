import "@patternfly/patternfly/patternfly.css";
import "./index.css"; // Add this line

import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// Component import

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
