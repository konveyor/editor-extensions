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

    if (!blocks) {
      return [];
    }

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
