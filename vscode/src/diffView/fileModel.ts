/*---------------------------------------------------------------------------------------------
 *  Contains substantial parts of: https://github.com/microsoft/vscode/blob/e1e29b63e245d9564f6acaafa53645ca4ca62f96/extensions/references-view/src/references/model.ts#L1
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

export class KonveyorFileModel implements FileItemNavigation<FileItem> {
  private _onDidChange = new vscode.EventEmitter<FileItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  readonly items: FileItem[] = [];

  constructor(locations: vscode.Location[] | vscode.LocationLink[]) {
    let last: FileItem | undefined;
    for (const item of locations.sort(KonveyorFileModel._compareLocations)) {
      const loc =
        item instanceof vscode.Location
          ? item
          : new vscode.Location(item.targetUri, item.targetRange);

      if (!last || KonveyorFileModel._compareUriIgnoreFragment(last.uri, loc.uri) !== 0) {
        last = new FileItem(loc.uri.with({ fragment: "" }), "", this);
        this.items.push(last);
      }
    }
  }

  private static _compareUriIgnoreFragment(a: vscode.Uri, b: vscode.Uri): number {
    const aStr = a.with({ fragment: "" }).toString();
    const bStr = b.with({ fragment: "" }).toString();
    if (aStr < bStr) {
      return -1;
    } else if (aStr > bStr) {
      return 1;
    }
    return 0;
  }

  private static _compareLocations(
    a: vscode.Location | vscode.LocationLink,
    b: vscode.Location | vscode.LocationLink,
  ): number {
    const aUri = a instanceof vscode.Location ? a.uri : a.targetUri;
    const bUri = b instanceof vscode.Location ? b.uri : b.targetUri;
    if (aUri.toString() < bUri.toString()) {
      return -1;
    } else if (aUri.toString() > bUri.toString()) {
      return 1;
    }

    const aRange = a instanceof vscode.Location ? a.range : a.targetRange;
    const bRange = b instanceof vscode.Location ? b.range : b.targetRange;
    if (aRange.start.isBefore(bRange.start)) {
      return -1;
    } else if (aRange.start.isAfter(bRange.start)) {
      return 1;
    } else {
      return 0;
    }
  }

  // --- adapter

  get message() {
    if (this.items.length === 0) {
      return "No results.";
    }
    const filesCount = this.items.length;
    return `Edits in ${filesCount} file(s)`;
  }

  location(item: FileItem) {
    return new vscode.Location(item.uri, new vscode.Position(0, 0));
  }

  next(item: FileItem): FileItem {
    return this._move(item, true) ?? item;
  }

  previous(item: FileItem): FileItem {
    return this._move(item, false) ?? item;
  }

  private _move(item: FileItem, fwd: boolean): FileItem | void {
    const delta = fwd ? +1 : -1;

    const _move = (item: FileItem): FileItem => {
      const idx = (this.items.indexOf(item) + delta + this.items.length) % this.items.length;
      return this.items[idx];
    };

    return _move(item);
  }

  remove(item: FileItem) {
    const idx = this.items.indexOf(item);
    if (idx >= 0) {
      this.items.splice(idx, 1);
    }
    this._onDidChange.fire(undefined);
  }

  apply(item: FileItem) {
    vscode.window.showInformationMessage(`[TODO] Apply resolutions to ${item.uri.fsPath}`);
  }

  revert(item: FileItem) {
    vscode.window.showInformationMessage(
      `[TODO] Discard local changes to resolutions for ${item.uri.fsPath}`,
    );
  }

  async asCopyText() {
    let result = "";
    for (const item of this.items) {
      result += `${await item.asCopyText()}\n`;
    }
    return result;
  }
}

export class KonveyorTreeDataProvider implements vscode.TreeDataProvider<FileItem> {
  private readonly _listener: vscode.Disposable;
  private readonly _onDidChange = new vscode.EventEmitter<FileItem | undefined>();

  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private readonly _model: KonveyorFileModel) {
    this._listener = _model.onDidChangeTreeData(() => this._onDidChange.fire(undefined));
  }

  dispose(): void {
    this._onDidChange.dispose();
    this._listener.dispose();
  }

  async getTreeItem(element: FileItem) {
    const result = new vscode.TreeItem(element.uri);
    result.contextValue = "file-item";
    result.description = true;
    result.iconPath = vscode.ThemeIcon.File;
    result.collapsibleState = vscode.TreeItemCollapsibleState.None;
    result.command = {
      command: "vscode.diff",
      title: "Open diff",
      arguments: [
        element.uri,
        vscode.Uri.from({
          scheme: "konveyorMemFs",
          path: "/" + vscode.workspace.asRelativePath(element.uri.fsPath),
        }),
        "Current file <-> Suggested changes",
      ],
    };
    return result;
  }

  async getChildren(element?: FileItem) {
    if (!element) {
      return this._model.items;
    }
    return undefined;
  }

  getParent(_element: FileItem) {
    return undefined;
  }
}

export class FileItem {
  constructor(
    readonly uri: vscode.Uri,
    readonly patch: string,
    readonly model: KonveyorFileModel,
  ) {}

  // --- adapter

  remove(): void {
    this.model.remove(this);
  }

  apply(): void {
    this.model.apply(this);
  }

  revert(): void {
    this.model.revert(this);
  }

  async asCopyText() {
    let result = `${vscode.workspace.asRelativePath(this.uri)}\n`;
    result += this.patch;
    return result;
  }
}
