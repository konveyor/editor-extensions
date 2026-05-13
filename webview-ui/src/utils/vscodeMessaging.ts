// utils/vscodeMessaging.ts

import { WebviewAction, WebviewActionType } from "@editor-extensions/shared";
import { vscode } from "./vscode";

export const sendVscodeMessage = (message: WebviewAction<WebviewActionType, unknown>) =>
  vscode.postMessage(message);
