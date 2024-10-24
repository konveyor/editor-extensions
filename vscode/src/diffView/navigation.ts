/*---------------------------------------------------------------------------------------------
 *  Contains substantial parts of: https://github.com/microsoft/vscode/blob/e1e29b63e245d9564f6acaafa53645ca4ca62f96/extensions/references-view/src/navigation.ts#L1
 *
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License.
 *
 *  MIT License
 *
 *  Copyright (c) 2015 - present Microsoft Corporation
 *
 *  Permission is hereby granted, free of charge, to any person obtaining a copy
 *  of this software and associated documentation files (the "Software"), to deal
 *  in the Software without restriction, including without limitation the rights
 *  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *  copies of the Software, and to permit persons to whom the Software is
 *  furnished to do so, subject to the following conditions:
 *
 *  The above copyright notice and this permission notice shall be included in all
 *  copies or substantial portions of the Software.
 *
 *  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *  SOFTWARE.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { FileItemNavigation } from "./diff-view";

export class Navigation {
  private readonly _disposables: vscode.Disposable[] = [];

  constructor(
    private readonly _view: vscode.TreeView<unknown>,
    private _delegate: FileItemNavigation<unknown>,
  ) {
    this._disposables.push(
      vscode.commands.registerCommand("konveyor.diffView.next", () => this.next(false)),
      vscode.commands.registerCommand("konveyor.diffView.prev", () => this.previous(false)),
    );
  }

  dispose(): void {
    vscode.Disposable.from(...this._disposables).dispose();
  }

  private _anchor(): undefined | unknown {
    const [sel] = this._view.selection;
    if (sel) {
      return sel;
    }
    return undefined;
  }

  private _open(loc: vscode.Location, preserveFocus: boolean) {
    vscode.commands.executeCommand(
      "vscode.diff",
      loc.uri,
      vscode.Uri.from({
        scheme: "konveyorMemFs",
        path: "/" + vscode.workspace.asRelativePath(loc.uri.fsPath),
      }),
      "Current file <-> Suggested changes",
      {
        preserveFocus,
      },
    );
  }

  previous(preserveFocus: boolean): void {
    const item = this._anchor();
    if (!item) {
      return;
    }
    const newItem = this._delegate.previous(item);
    const newLocation = this._delegate.location(newItem);
    if (newLocation) {
      this._view.reveal(newItem, { select: true, focus: true });
      this._open(newLocation, preserveFocus);
    }
  }

  next(preserveFocus: boolean): void {
    const item = this._anchor();
    if (!item) {
      return;
    }
    const newItem = this._delegate.next(item);
    const newLocation = this._delegate.location(newItem);
    if (newLocation) {
      this._view.reveal(newItem, { select: true, focus: true });
      this._open(newLocation, preserveFocus);
    }
  }
}
