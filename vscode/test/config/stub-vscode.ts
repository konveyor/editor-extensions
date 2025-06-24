import * as sinon from "sinon";
import url from "node:url";

// Mock classes for objects like Uri, Position, Range, Selection
export class Uri {
  fsPath: string;
  path: string;
  constructor(path: string) {
    this.path = path;
    this.fsPath = url.fileURLToPath(path);
  }
  static parse(value: string) {
    return new Uri(value);
  }
  static file(path: string) {
    return new Uri(path);
  }
  toString() {
    return this.fsPath;
  }
}

export class Position {
  line: number;
  character: number;
  constructor(line: number, character: number) {
    this.line = line;
    this.character = character;
  }
}

export class Range {
  start: unknown;
  end: unknown;
  constructor(start: unknown, end: unknown) {
    this.start = start;
    this.end = end;
  }
}

export class Selection {
  start: unknown;
  end: unknown;
  active: unknown;
  anchor: unknown;
  constructor(anchor: unknown, active: unknown) {
    this.start = anchor;
    this.end = active;
    this.active = active;
    this.anchor = anchor;
  }
}

export class Diagnostic {
  range: Range;
  message: string;
  severity?: DiagnosticSeverity;
  source?: string;
  code?: unknown;
  relatedInformation?: unknown[];
  tags?: unknown[];
  constructor(range: Range, message: string, severity?: DiagnosticSeverity) {
    this.range = range;
    this.message = message;
    this.severity = severity;
  }
}
// ... add more as needed

// mock enums
/**
 * Represents the severity of diagnostics.
 */
export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

// mock "vscode" API
const mockVscode = {
  Uri,
  Position,
  Range,
  Selection,
  Diagnostic,

  DiagnosticSeverity,

  window: {
    showInformationMessage: sinon.stub(),
    showErrorMessage: sinon.stub(),
    createOutputChannel: sinon.stub().returns({
      appendLine: sinon.stub(),
      show: sinon.stub(),
      hide: sinon.stub(),
      dispose: sinon.stub(),
    }),
  },
  commands: {
    registerCommand: sinon.stub(),
    executeCommand: sinon.stub(),
  },
  workspace: {
    getConfiguration: sinon.stub().returns({
      get: sinon.stub(),
      has: sinon.stub(),
      inspect: sinon.stub(),
      update: sinon.stub(),
    }),
  },
};

export function resetStubs() {
  sinon.resetBehavior();
  sinon.resetHistory();
}

export default mockVscode;
