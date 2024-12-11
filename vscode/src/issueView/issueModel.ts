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

import { Incident, RuleSet } from "@editor-extensions/shared";
import { Immutable } from "immer";
import * as vscode from "vscode";
import { allIncidents } from "./transformation";

export class IssuesModel {
  private _onDidChange = new vscode.EventEmitter<
    IncidentTypeItem | FileItem | ReferenceItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChange.event;

  readonly items: IncidentTypeItem[] = [];

  constructor() {}

  findIncidentType(msg: string) {
    return this.items.find((it) => it.msg === msg);
  }
  findFileItem(incidentMsg: string, fileUri: string) {
    return this.findIncidentType(incidentMsg)?.files.find((it) => it.uri === fileUri);
  }

  updateIssues(ruleSets: Immutable<RuleSet[]>) {
    const incidentsByMsg: { [msg: string]: [string, Incident][] } = allIncidents(ruleSets)
      .map((it): [string, string, Incident] => [it.message, it.uri, it])
      .reduce(
        (acc, [msg, uri, incident]) => {
          if (!acc[msg]) {
            acc[msg] = [];
          }
          acc[msg].push([uri, incident]);
          return acc;
        },
        {} as { [msg: string]: [string, Incident][] },
      );

    // entries [msg, incidentsByFile]
    const treeItemsAsEntries: [string, { [uri: string]: Incident[] }][] = Object.entries(
      incidentsByMsg,
    ).map(([msg, incidents]) => [
      msg,
      incidents.reduce(
        (acc, [uri, incident]) => {
          if (!acc[uri]) {
            acc[uri] = [];
          }
          acc[uri].push(incident);
          return acc;
        },
        {} as { [uri: string]: Incident[] },
      ),
    ]);

    const items = treeItemsAsEntries
      .map(([msg, incidentsByFile]): [string, [string, Incident[]][]] => [
        msg,
        Object.entries(incidentsByFile),
      ])
      .map(([msg, incidentsByFileAsEntries]): [string, FileItem[]] => [
        msg,
        incidentsByFileAsEntries.map(
          ([uri, incidents]) =>
            new FileItem(
              uri,
              incidents
                .map((it) => new ReferenceItem(it, uri, this))
                .toSorted((a, b) => a.incident.lineNumber! - b.incident.lineNumber!),
              msg,
              this,
            ),
        ),
      ])
      .map(
        ([msg, fileItems]) =>
          new IncidentTypeItem(
            msg,
            fileItems.toSorted((a, b) => a.uri.localeCompare(b.uri)),
            this,
          ),
      );

    this.items.splice(0, this.items.length);
    this.items.push(...items);
    this._onDidChange.fire(undefined);
  }

  // --- adapter

  countIncidents() {
    return this.items.reduce(
      (sum, it) => sum + it.files.reduce((sum, fileItem) => sum + fileItem.references.length, 0),
      0,
    );
  }

  get badge(): vscode.ViewBadge | undefined {
    const numberOfIncidents = this.countIncidents();
    return numberOfIncidents
      ? {
          tooltip: `${numberOfIncidents} incident(s) found`,
          value: numberOfIncidents,
        }
      : undefined;
  }

  get message() {
    if (this.items.length === 0) {
      return vscode.l10n.t("No results.");
    }
    //unique files
    const files = this.items.reduce(
      (prev, cur) => new Set([...cur.files.map((it) => it.uri), ...Array.from(prev)]),
      new Set(),
    ).size;
    const totalIncidents = this.countIncidents();
    if (totalIncidents === 1 && files === 1) {
      return vscode.l10n.t("{0} result in {1} file", totalIncidents, files);
    } else if (totalIncidents === 1) {
      return vscode.l10n.t("{0} result in {1} files", totalIncidents, files);
    } else if (files === 1) {
      return vscode.l10n.t("{0} results in {1} file", totalIncidents, files);
    } else {
      return vscode.l10n.t("{0} results in {1} files", totalIncidents, files);
    }
  }

  location(item: IncidentTypeItem | FileItem | ReferenceItem) {
    if (item instanceof ReferenceItem) {
      return item.location;
    }
    if (item instanceof FileItem) {
      return item.references[0]?.location ?? item.location;
    }
    return undefined;
  }

  remove(item: IncidentTypeItem | FileItem | ReferenceItem) {
    // TODO not implemented
  }
}

export class IssuesTreeDataProvider
  implements vscode.TreeDataProvider<IncidentTypeItem | FileItem | ReferenceItem>
{
  private readonly _listener: vscode.Disposable;
  private readonly _onDidChange = new vscode.EventEmitter<
    IncidentTypeItem | FileItem | ReferenceItem | undefined
  >();

  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private readonly _model: IssuesModel) {
    this._listener = _model.onDidChangeTreeData(() => this._onDidChange.fire(undefined));
  }

  dispose(): void {
    this._onDidChange.dispose();
    this._listener.dispose();
  }

  async getTreeItem(element: IncidentTypeItem | FileItem | ReferenceItem) {
    if (element instanceof FileItem) {
      // files
      const result = new vscode.TreeItem(element.location.uri);
      result.contextValue = "file-item";
      result.description = true;
      result.iconPath = vscode.ThemeIcon.File;
      result.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
      return result;
    } else if (element instanceof ReferenceItem) {
      // references
      const { range } = element.location;
      const doc = await element.getDocument();
      const preview = getPreviewChunks(doc, range);

      // use fixed padding
      // TODO: retrieve max line number to determine pad count at runtime
      const lineNumber = (element.incident?.lineNumber?.toString() ?? " ").padStart(3);
      const label: vscode.TreeItemLabel = {
        label: `${lineNumber}  ${preview}`,
        // highlight line number
        highlights: [[0, 3]],
      };

      const result = new vscode.TreeItem(label);
      result.collapsibleState = vscode.TreeItemCollapsibleState.None;
      result.contextValue = "reference-item";
      result.command = {
        command: "vscode.open",
        title: vscode.l10n.t("Open Reference"),
        arguments: [
          element.location.uri,
          { selection: range.with({ end: range.start }) } satisfies vscode.TextDocumentShowOptions,
        ],
      };
      return result;
    } else {
      // IncidentTypeItem
      const result = new vscode.TreeItem(element.msg);
      result.contextValue = "incident-type-item";
      result.description = true;
      result.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
      return result;
    }
  }

  async getChildren(element?: IncidentTypeItem | FileItem | ReferenceItem) {
    if (!element) {
      return this._model.items;
    }
    if (element instanceof IncidentTypeItem) {
      return element.files;
    }
    if (element instanceof FileItem) {
      return element.references;
    }
    return undefined;
  }

  getParent(element: IncidentTypeItem | FileItem | ReferenceItem) {
    if (element instanceof IncidentTypeItem) {
      return undefined;
    }
    if (element instanceof FileItem) {
      return element.getParent();
    }
    if (element instanceof ReferenceItem) {
      return element.getParent();
    }
    return undefined;
  }
}

export class IncidentTypeItem {
  constructor(
    readonly msg: string,
    readonly files: Array<FileItem>,
    readonly model: IssuesModel,
  ) {}

  public hasOneChild() {
    return this.files.length === 1;
  }
}

export class FileItem {
  readonly location: vscode.Location;
  constructor(
    readonly uri: string,
    readonly references: Array<ReferenceItem>,
    readonly incidentMsg: string,
    readonly model: IssuesModel,
  ) {
    this.location = new vscode.Location(
      vscode.Uri.parse(uri),
      new vscode.Position(0, Number.MAX_SAFE_INTEGER),
    );
  }

  public hasOneChild() {
    return this.references.length === 1;
  }

  getParent() {
    return this.model.findIncidentType(this.incidentMsg);
  }
  // --- adapter

  remove(): void {
    // TODO not implemented
  }
}

export class ReferenceItem {
  private _document: Thenable<vscode.TextDocument> | undefined;
  readonly location: vscode.Location;

  constructor(
    readonly incident: Incident,
    readonly fileUri: string,
    readonly model: IssuesModel,
  ) {
    const safeLineNumber = Math.max((incident.lineNumber ?? 0) - 1, 0);
    this.location = new vscode.Location(
      vscode.Uri.parse(fileUri),
      new vscode.Range(
        new vscode.Position(safeLineNumber, 0),
        new vscode.Position(safeLineNumber, Number.MAX_SAFE_INTEGER),
      ),
    );
  }
  public hasOneChild() {
    return true;
  }

  async getDocument() {
    if (!this._document) {
      this._document = vscode.workspace.openTextDocument(this.location.uri);
    }
    return this._document;
  }

  getParent() {
    return this.model.findFileItem(this.incident.message, this.fileUri);
  }

  // --- adapter

  remove(): void {
    // TODO not implemented
  }
}

/* preview modified to handle full-lines only
 */
export function getPreviewChunks(
  doc: vscode.TextDocument,
  range: vscode.Range,
  trim: boolean = true,
) {
  const inside = doc.getText(new vscode.Range(range.start, range.start.translate(0, 331)));
  return trim ? inside.replace(/^\s*/g, "") : inside;
}
