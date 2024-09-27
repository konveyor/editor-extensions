import { KonveyorGUIWebviewViewProvider } from "./KonveyorGUIWebviewViewProvider";

export interface ExtensionState {
  sidebarProvider: KonveyorGUIWebviewViewProvider;
  sharedState: SharedState;
  webviewProviders: Set<KonveyorGUIWebviewViewProvider>;
  // Add other shared components as needed
}

// src/sharedState.ts
export class SharedState {
  private state: { [key: string]: any } = {};

  set(key: string, value: any) {
    this.state[key] = value;
  }

  get(key: string) {
    return this.state[key];
  }

  getAll() {
    return this.state;
  }
}
