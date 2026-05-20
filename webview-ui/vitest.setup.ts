// vitest.setup.ts
// Mock the VS Code API globally
Object.defineProperty(window, "vscode", {
  value: {
    postMessage: (msg: any) => {
      // Collect dispatched messages for test assertions
      (globalThis as any).__dispatchedMessages =
        (globalThis as any).__dispatchedMessages || [];
      (globalThis as any).__dispatchedMessages.push(msg);
    },
    getState: () => ({}),
  },
  writable: true,
});

// Mock viewType
Object.defineProperty(window, "viewType", {
  value: "sidebar",
  writable: true,
});
