import * as vscode from "vscode";
import { SimpleDiffCodeLens } from "./diffManager";

export interface DiffBlock {
  startLine: number;
  numAdded: number;
  numRemoved: number;
  fileUri: string;
  messageToken: string;
  addedContent?: string[]; // Actual content to be added
  removedContent?: string[]; // Actual content being removed
}

export class DiffCodeLensProvider implements vscode.CodeLensProvider {
  private _eventEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  onDidChangeCodeLenses: vscode.Event<void> = this._eventEmitter.event;

  constructor(private readonly codeLensMap: Map<string, SimpleDiffCodeLens[]>) {}

  public refresh(): void {
    this._eventEmitter.fire();
  }

  // Methods removed - now using manager pattern

  public provideCodeLenses(
    document: vscode.TextDocument,
    _: vscode.CancellationToken,
  ): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
    const uri = document.uri.toString();
    const blocks = this.codeLensMap.get(uri);

    if (!blocks || blocks.length === 0) {
      return [];
    }

    console.log(`CodeLens provider: ${blocks.length} blocks for ${uri}`);
    blocks.forEach((block, i) => {
      console.log(
        `Block ${i}: start=${block.start}, numAdded=${block.numAdded}, numRemoved=${block.numRemoved}`,
      );
    });

    const codeLenses: vscode.CodeLens[] = [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const start = new vscode.Position(block.start, 0);
      // Use Continue's exact range calculation: spans numAdded + numRemoved lines
      const range = new vscode.Range(start, start.translate(block.numAdded + block.numRemoved));

      console.log(
        `Creating CodeLens for block ${i} at line ${block.start} (multi-line range: ${block.numAdded + block.numRemoved} lines)`,
      );

      // Accept button
      codeLenses.push(
        new vscode.CodeLens(range, {
          title: `Accept`,
          command: "konveyor.acceptDiffBlock",
          arguments: [uri, i],
        }),
      );

      // Reject button
      codeLenses.push(
        new vscode.CodeLens(range, {
          title: `Reject`,
          command: "konveyor.rejectDiffBlock",
          arguments: [uri, i],
        }),
      );
    }

    console.log(`CodeLens provider: created ${codeLenses.length} CodeLens items`);
    return codeLenses;
  }
}
