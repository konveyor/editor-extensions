import * as vscode from "vscode";

export interface DiffBlock {
  startLine: number;
  numAdded: number;
  numRemoved: number;
  fileUri: string;
  messageToken: string;
}

export class DiffCodeLensProvider implements vscode.CodeLensProvider {
  private _eventEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  onDidChangeCodeLenses: vscode.Event<void> = this._eventEmitter.event;

  constructor(private readonly diffBlocks: Map<string, DiffBlock[]>) {}

  public refresh(): void {
    this._eventEmitter.fire();
  }

  public addDiffBlocks(fileUri: string, blocks: DiffBlock[]): void {
    this.diffBlocks.set(fileUri, blocks);
    this.refresh();
  }

  public clearDiffBlocks(fileUri?: string): void {
    if (fileUri) {
      this.diffBlocks.delete(fileUri);
    } else {
      this.diffBlocks.clear();
    }
    this.refresh();
  }

  public provideCodeLenses(
    document: vscode.TextDocument,
    _: vscode.CancellationToken,
  ): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
    const uri = document.uri.toString();
    const blocks = this.diffBlocks.get(uri);

    if (!blocks || blocks.length === 0) {
      return [];
    }

    const codeLenses: vscode.CodeLens[] = [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const range = new vscode.Range(
        new vscode.Position(block.startLine, 0),
        new vscode.Position(block.startLine, 0),
      );

      // Accept button
      codeLenses.push(
        new vscode.CodeLens(range, {
          title: `Accept`,
          command: "konveyor.acceptDiffBlock",
          arguments: [uri, i, block.messageToken],
        }),
      );

      // Reject button
      codeLenses.push(
        new vscode.CodeLens(range, {
          title: `Reject`,
          command: "konveyor.rejectDiffBlock",
          arguments: [uri, i, block.messageToken],
        }),
      );
    }

    return codeLenses;
  }
}
