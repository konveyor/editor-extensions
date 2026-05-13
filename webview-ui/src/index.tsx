import "@patternfly/patternfly/patternfly.css";
import "@patternfly/chatbot/dist/css/main.css";
import "@patternfly/react-core/dist/styles/base.css";
import "./index.css";

import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
