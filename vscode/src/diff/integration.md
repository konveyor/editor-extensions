# Integrating Continue's Vertical Diff System

## Overview

This document explains how to integrate Continue's vertical diff system with your existing static diff flow.

## Key Integration Points

### 1. Replace SimpleDiffManager in commands.ts

```typescript
// commands.ts - Update the showDiffWithDecorations command

import { VerticalDiffManager } from "./diff/vertical/manager";
import { StaticDiffAdapter } from "./diff/staticDiffAdapter";
import { VsCodeWebviewProtocol } from "./webviewProtocol";
import EditDecorationManager from "./quickEdit/EditDecorationManager";

// Initialize the vertical diff system (do this once during extension activation)
const webviewProtocol = new VsCodeWebviewProtocol();
const editDecorationManager = new EditDecorationManager();
const verticalDiffManager = new VerticalDiffManager(
  webviewProtocol,
  editDecorationManager,
  state.ide // Your VS Code IDE implementation
);

// Create the static diff adapter
const staticDiffAdapter = new StaticDiffAdapter(verticalDiffManager);

// Update the command
"konveyor.showDiffWithDecorations": async (
  filePath: string,
  diff: string,
  content: string,
  messageToken: string,
) => {
  try {
    logger.info("showDiffWithDecorations called", { filePath, messageToken });

    // Get the original content (before the diff)
    const uri = vscode.Uri.file(filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const originalContent = doc.getText();

    // Apply the static diff using Continue's system
    await staticDiffAdapter.applyStaticDiff(
      filePath,
      diff,
      originalContent,
      messageToken
    );

  } catch (error) {
    logger.error("Error in showDiffWithDecorations:", error);
    vscode.window.showErrorMessage(
      `Failed to show diff with decorations: ${error}`
    );
  }
}
```

### 2. Wire up Accept/Reject Actions

```typescript
// commands.ts - Add accept/reject commands

"konveyor.acceptDiff": async (filePath?: string) => {
  if (!filePath) {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) return;
    filePath = activeEditor.document.fileName;
  }

  await staticDiffAdapter.acceptAll(filePath);
},

"konveyor.rejectDiff": async (filePath?: string) => {
  if (!filePath) {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) return;
    filePath = activeEditor.document.fileName;
  }

  await staticDiffAdapter.rejectAll(filePath);
},

"konveyor.acceptDiffBlock": async (filePath: string, blockIndex: number) => {
  await staticDiffAdapter.acceptRejectBlock(filePath, blockIndex, true);
},

"konveyor.rejectDiffBlock": async (filePath: string, blockIndex: number) => {
  await staticDiffAdapter.acceptRejectBlock(filePath, blockIndex, false);
}
```

### 3. Update webviewMessageHandler.ts

```typescript
// webviewMessageHandler.ts - Update FILE_RESPONSE handler

FILE_RESPONSE: async ({ responseId, messageToken, path, content }, state) => {
  // When user accepts/rejects from the webview
  if (responseId === "apply") {
    await vscode.commands.executeCommand("konveyor.acceptDiff", path);
  } else if (responseId === "reject") {
    await vscode.commands.executeCommand("konveyor.rejectDiff", path);
  }

  // Continue with existing handleFileResponse logic
  handleFileResponse(messageToken, responseId, path, content, state);
};
```

### 4. CodeLens Integration

Continue's system uses CodeLens to show accept/reject buttons. You need to:

1. Register the CodeLens provider (already in your extracted code)
2. Update the provider to use verticalDiffManager's fileUriToCodeLens map
3. Handle CodeLens commands

```typescript
// diffCodeLensProvider.ts - Update to use VerticalDiffManager

export class DiffCodeLensProvider implements vscode.CodeLensProvider {
  constructor(private verticalDiffManager: VerticalDiffManager) {}

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const fileUri = document.uri.toString();
    const blocks = this.verticalDiffManager.fileUriToCodeLens.get(fileUri);

    if (!blocks) return [];

    return blocks.flatMap((block, index) => {
      const range = new vscode.Range(block.start, 0, block.start, 0);

      return [
        new vscode.CodeLens(range, {
          title: `✓ Accept (${block.numGreen} additions, ${block.numRed} deletions)`,
          command: "konveyor.acceptDiffBlock",
          arguments: [fileUri, index],
        }),
        new vscode.CodeLens(range, {
          title: "✗ Reject",
          command: "konveyor.rejectDiffBlock",
          arguments: [fileUri, index],
        }),
      ];
    });
  }
}
```

## Flow Diagram

```
ModifiedFileMessage.tsx
    ↓ (SHOW_DIFF_WITH_DECORATORS)
webviewMessageHandler.ts
    ↓ (konveyor.showDiffWithDecorations)
commands.ts
    ↓
StaticDiffAdapter
    ↓ (converts static diff to stream)
VerticalDiffManager
    ↓
VerticalDiffHandler
    ↓ (creates decorations & blank lines)
Editor Display
    ↓ (user clicks CodeLens)
processDiff.ts
    ↓ (accept/reject)
File Updated
```

## Key Differences from SimpleDiffManager

1. **Blank Line Placeholders**: Continue's system inserts actual blank lines for deletions
2. **Ghost Text**: Deleted lines appear as ghost text on blank lines
3. **Buffer Manipulation**: Direct text buffer edits instead of just decorations
4. **CodeLens Actions**: Inline accept/reject buttons per diff block
5. **Streaming Support**: Can handle both static and streaming diffs

## Migration Checklist

- [ ] Remove SimpleDiffManager and related code
- [ ] Initialize VerticalDiffManager during extension activation
- [ ] Create StaticDiffAdapter instance
- [ ] Update showDiffWithDecorations command
- [ ] Wire up accept/reject commands
- [ ] Register CodeLens provider
- [ ] Test with sample diffs
- [ ] Handle edge cases (empty files, large diffs, etc.)

## Dependencies to Add

```json
{
  "dependencies": {
    "diff": "^5.1.0"
  }
}
```

## Testing

Test with various diff scenarios:

1. Simple additions
2. Simple deletions
3. Mixed changes
4. Multi-hunk diffs
5. New file creation
6. File deletion
7. Large files with many changes
