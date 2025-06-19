import * as sinon from "sinon";

// mock "vscode" API
export const mockVscode = {
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

  // Mock classes for objects like Uri, Position, Range, Selection
  Uri: class MockUri {
    fsPath: string;
    constructor(path: string) {
      this.fsPath = path;
    }
    static file(path: string) {
      return new MockUri(path);
    }
    toString() {
      return this.fsPath;
    } // Important for some operations
  },
  Position: class MockPosition {
    line: number;
    character: number;
    constructor(line: number, character: number) {
      this.line = line;
      this.character = character;
    }
  },
  Range: class MockRange {
    start: any;
    end: any;
    constructor(start: any, end: any) {
      this.start = start;
      this.end = end;
    }
  },
  Selection: class MockSelection {
    start: any;
    end: any;
    active: any;
    anchor: any;
    constructor(anchor: any, active: any) {
      this.start = anchor;
      this.end = active;
      this.active = active;
      this.anchor = anchor;
    }
  },
  // ... add more as needed
};

export function resetStubs() {
  sinon.resetBehavior();
  sinon.resetHistory();
}

export default mockVscode;
