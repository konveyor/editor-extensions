import * as vscode from "vscode";
import { VerticalDiffManager } from "./vertical/manager";
import { EXTENSION_NAME } from "../utilities/constants";

export class VerticalDiffCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
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

    const codeLenses: vscode.CodeLens[] = [];

    // Add accept/reject all buttons at the top of the file
    const topRange = new vscode.Range(0, 0, 0, 0);
    codeLenses.push(
      new vscode.CodeLens(topRange, {
        title: `✓ Accept All Changes (${blocks.reduce((sum, b) => sum + b.numGreen, 0)}+, ${blocks.reduce((sum, b) => sum + b.numRed, 0)}-)`,
        command: `${EXTENSION_NAME}.acceptDiff`,
        arguments: [document.uri.fsPath],
      }),
      new vscode.CodeLens(topRange, {
        title: "✗ Reject All Changes",
        command: `${EXTENSION_NAME}.rejectDiff`,
        arguments: [document.uri.fsPath],
      }),
    );

    // Add individual block accept/reject buttons
    blocks.forEach((block, index) => {
      const range = new vscode.Range(block.start, 0, block.start, 0);
      codeLenses.push(
        new vscode.CodeLens(range, {
          title: `✓ Accept (${block.numGreen}+, ${block.numRed}-)`,
          command: `${EXTENSION_NAME}.acceptVerticalDiffBlock`,
          arguments: [fileUri, index],
        }),
        new vscode.CodeLens(range, {
          title: "✗ Reject",
          command: `${EXTENSION_NAME}.rejectVerticalDiffBlock`,
          arguments: [fileUri, index],
        }),
      );
    });

    return codeLenses;
  }

  dispose(): void {
    this._onDidChangeCodeLenses.dispose();
  }
}
