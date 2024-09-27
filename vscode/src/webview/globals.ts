export interface VscodeApi {
  postMessage(message: any): void;
  // Include other methods if needed (e.g., setState, getState)
}

// Declare the global window interface to include 'vscode'
declare global {
  interface Window {
    vscode: VscodeApi;
  }
}

// Export 'vscode' from 'window'
export const vscode = window.vscode;
