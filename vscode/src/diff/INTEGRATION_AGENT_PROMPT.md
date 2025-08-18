# Agent Prompt: Integrate Continue's Vertical Diff System

## Context

We have extracted Continue's vertical diff system which creates blank line placeholders for deleted lines with ghost text decorations. We need to integrate this with our existing static diff flow where ModifiedFileMessage.tsx sends diffs through webviewMessageHandler.ts to commands.ts.

## Current Assets

- **Extracted Continue code**:
  - `vscode/src/diff/vertical/handler.ts` - Core diff handler
  - `vscode/src/diff/vertical/manager.ts` - Diff manager
  - `vscode/src/diff/vertical/decorations.ts` - Decoration managers
  - `vscode/src/core-diff/diff/myers.ts` - Myers diff algorithm
- **Integration helpers**:
  - `vscode/src/diff/staticDiffAdapter.ts` - Adapter to convert static diffs to streaming
  - `vscode/src/diff/vscodeIde.ts` - VS Code IDE implementation
  - `vscode/src/core-diff/index.ts` - Type definitions
- **Current flow files**:
  - `webview-ui/src/components/ResolutionsPage/ModifiedFile/ModifiedFileMessage.tsx`
  - `vscode/src/webviewMessageHandler.ts`
  - `vscode/src/commands.ts`

## Your Task

### 1. Remove SimpleDiffManager Code

- [ ] In `commands.ts`, remove:
  - `SimpleDiffManager` import and initialization
  - `simpleDiffManager` instance
  - `diffCodeLensProvider` that uses SimpleDiffManager
- [ ] In `commands.ts`, comment out or remove the existing `konveyor.showDiffWithDecorations` command
- [ ] Delete or archive `vscode/src/diffManager.ts` if it exists
- [ ] Delete or archive `vscode/src/decorations.ts` (old decoration system)

### 2. Initialize Vertical Diff System

In `commands.ts`, add at the top after imports:

```typescript
import { VerticalDiffManager } from "./diff/vertical/manager";
import { StaticDiffAdapter } from "./diff/staticDiffAdapter";
import { VsCodeIde } from "./diff/vscodeIde";

// Initialize vertical diff system (do this once, outside commandsMap)
let verticalDiffManager: VerticalDiffManager;
let staticDiffAdapter: StaticDiffAdapter;

function initializeVerticalDiff(state: ExtensionState) {
  // Create minimal webview protocol
  const webviewProtocol = {
    request: async (method: string, params: any) => {
      if (method === "updateApplyState") {
        state.logger.info("Diff status update", params);
      }
    },
  };

  // Create minimal edit decoration manager
  const editDecorationManager = { clear: () => {} };

  // Create VS Code IDE implementation
  const ide = new VsCodeIde();

  // Initialize managers
  verticalDiffManager = new VerticalDiffManager(
    webviewProtocol as any,
    editDecorationManager as any,
    ide,
  );

  staticDiffAdapter = new StaticDiffAdapter(verticalDiffManager);

  return { verticalDiffManager, staticDiffAdapter };
}
```

### 3. Update showDiffWithDecorations Command

Replace the existing command in `commands.ts`:

```typescript
"konveyor.showDiffWithDecorations": async (
  filePath: string,
  diff: string,
  content: string,
  messageToken: string,
) => {
  try {
    logger.info("showDiffWithDecorations using vertical diff", { filePath, messageToken });

    // Initialize if needed
    if (!verticalDiffManager) {
      initializeVerticalDiff(state);
    }

    // Get original content
    const uri = vscode.Uri.file(filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const originalContent = doc.getText();

    // Apply using Continue's system
    await staticDiffAdapter.applyStaticDiff(
      filePath,
      diff,
      originalContent,
      messageToken
    );

    logger.info("Vertical diff applied successfully");
  } catch (error) {
    logger.error("Error in vertical diff:", error);
    vscode.window.showErrorMessage(`Failed to show diff: ${error}`);
  }
}
```

### 4. Add Accept/Reject Commands

Add these new commands to `commands.ts`:

```typescript
"konveyor.acceptDiff": async (filePath?: string) => {
  if (!filePath) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    filePath = editor.document.fileName;
  }
  await staticDiffAdapter.acceptAll(filePath);
  vscode.window.showInformationMessage("Changes accepted");
},

"konveyor.rejectDiff": async (filePath?: string) => {
  if (!filePath) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    filePath = editor.document.fileName;
  }
  await staticDiffAdapter.rejectAll(filePath);
  vscode.window.showInformationMessage("Changes rejected");
}
```

### 5. Create CodeLens Provider

Create a new file `vscode/src/diff/verticalDiffCodeLens.ts`:

```typescript
import * as vscode from "vscode";
import { VerticalDiffManager } from "./vertical/manager";

export class VerticalDiffCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor(private verticalDiffManager: VerticalDiffManager) {}

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const fileUri = document.uri.toString();
    const blocks = this.verticalDiffManager.fileUriToCodeLens.get(fileUri);

    if (!blocks) return [];

    return blocks.flatMap((block, index) => {
      const range = new vscode.Range(block.start, 0, block.start, 0);
      return [
        new vscode.CodeLens(range, {
          title: `✓ Accept (${block.numGreen}+, ${block.numRed}-)`,
          command: "konveyor.acceptVerticalDiffBlock",
          arguments: [fileUri, index],
        }),
        new vscode.CodeLens(range, {
          title: "✗ Reject",
          command: "konveyor.rejectVerticalDiffBlock",
          arguments: [fileUri, index],
        }),
      ];
    });
  }
}
```

### 6. Register CodeLens in registerAllCommands

In `commands.ts`, update the `registerAllCommands` function:

```typescript
import { VerticalDiffCodeLensProvider } from "./diff/verticalDiffCodeLens";

export function registerAllCommands(state: ExtensionState) {
  // ... existing code ...

  // Initialize vertical diff system
  const { verticalDiffManager } = initializeVerticalDiff(state);

  // Create and register CodeLens provider
  const verticalCodeLensProvider = new VerticalDiffCodeLensProvider(verticalDiffManager);

  state.extensionContext.subscriptions.push(
    vscode.languages.registerCodeLensProvider("*", verticalCodeLensProvider),
  );

  // Connect refresh callback
  verticalDiffManager.refreshCodeLens = () => verticalCodeLensProvider.refresh();

  // ... rest of registration ...
}
```

### 7. Update webviewMessageHandler.ts

No changes needed! The existing flow will work:

- `SHOW_DIFF_WITH_DECORATORS` → calls `konveyor.showDiffWithDecorations`
- `FILE_RESPONSE` → can optionally call `konveyor.acceptDiff` or `konveyor.rejectDiff`

### 8. Clean Up Dependencies

In `package.json`, ensure you have:

```json
{
  "dependencies": {
    "diff": "^5.1.0"
  }
}
```

### 9. Test the Integration

Test with this flow:

1. Click "View with Decorations" in ModifiedFileMessage
2. Verify blank lines appear for deletions with ghost text
3. Verify green highlights for additions
4. Check CodeLens buttons appear at each diff block
5. Test accept/reject functionality

## Expected Behavior

- **Deletions**: Show as blank lines with gray ghost text showing what was removed
- **Additions**: Show with green background highlighting
- **CodeLens**: Accept/Reject buttons appear at the start of each diff block
- **Accept**: Removes red ghost text, keeps green additions
- **Reject**: Restores red lines, removes green additions

## Troubleshooting

- If decorations don't appear: Check console for errors in parseUnifiedDiffToDiffLines
- If CodeLens missing: Verify provider is registered and refresh is connected
- If accept/reject fails: Check file URIs are consistent (string vs Uri object)

## Success Criteria

- [ ] SimpleDiffManager completely removed
- [ ] Vertical diff shows blank lines for deletions
- [ ] Ghost text appears on deletion lines
- [ ] CodeLens buttons work for accept/reject
- [ ] No console errors during diff display
- [ ] File saves correctly after accepting changes

## Notes

- The vertical diff system directly modifies the text buffer (inserts blank lines)
- This is different from SimpleDiffManager which only added decorations
- The blank lines make the diff much clearer to review
- Continue's approach handles complex multi-hunk diffs better
