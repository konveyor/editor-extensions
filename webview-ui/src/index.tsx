import "@patternfly/patternfly/patternfly.css";
import "@patternfly/chatbot/dist/css/main.css";

import "./index.css";

import { createRoot } from "react-dom/client";
import App from "./App";
import React from "react";

// Component import

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
