// vscode.ts
export interface VscodeApi {
  postMessage(message: any): void;
  getState(): any;
}

// Declare the global window interface to include 'vscode'
declare global {
  interface Window {
    vscode: VscodeApi;
  }
}

// Wait until the DOM is fully loaded before assigning vscode
export const vscode: VscodeApi = window.vscode;
