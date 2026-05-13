import { WebviewType } from "@editor-extensions/shared";

// vscode.ts
export interface VscodeApi {
  postMessage(message: any): void;
  getState(): any;
}

// Declare the global window interface to include 'vscode'
declare global {
  interface Window {
    vscode: VscodeApi;
    viewType: WebviewType; // Declare the expected types for viewType
  }
}

// Wait until the DOM is fully loaded before assigning vscode
export const vscode: VscodeApi = window.vscode;

// export const viewType: string = "sidebar" | "resolution";
export const viewType: WebviewType = window.viewType || "sidebar"; // Default to "sidebar" if not set
