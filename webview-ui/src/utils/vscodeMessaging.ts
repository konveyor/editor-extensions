// utils/vscodeMessaging.ts

import { vscode } from "./vscode";

export const sendVscodeMessage = (command: string, data: any) => {
  vscode.postMessage({ command, ...data });
};
