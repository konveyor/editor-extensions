/**
 * Test command to verify decorations work in isolation
 */

import * as vscode from "vscode";

export function testDecorations() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage("No active editor");
    return;
  }

  console.log("[TEST] Testing decorations on", editor.document.fileName);

  // Test 1: Add green decoration to line 0
  const greenDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: { id: "diffEditor.insertedLineBackground" },
    outlineWidth: "1px",
    outlineStyle: "solid",
    outlineColor: { id: "diffEditor.insertedTextBorder" },
  });

  const greenRange = new vscode.Range(0, 0, 0, Number.MAX_SAFE_INTEGER);
  console.log("[TEST] Setting green decoration at line 0");
  editor.setDecorations(greenDecoration, [greenRange]);

  // Test 2: Add ghost text decoration to line 1
  const ghostDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: { id: "diffEditor.removedLineBackground" },
    after: {
      contentText: "// This is ghost text",
      color: "#808080",
      textDecoration: "none; white-space: pre",
    },
  });

  const ghostRange = new vscode.Range(1, 0, 1, 0);
  console.log("[TEST] Setting ghost text decoration at line 1");
  editor.setDecorations(ghostDecoration, [ghostRange]);

  vscode.window.showInformationMessage(
    "Test decorations applied: Line 0 should be green, Line 1 should have ghost text",
  );

  // Clean up after 5 seconds
  setTimeout(() => {
    greenDecoration.dispose();
    ghostDecoration.dispose();
    console.log("[TEST] Decorations cleaned up");
  }, 5000);
}
