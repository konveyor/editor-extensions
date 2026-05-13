/**
 * Essential type definitions for the vertical diff system
 */

export type DiffType = "old" | "new" | "same";

export interface DiffLine {
  type: DiffType;
  line: string;
}

export interface DiffChar {
  type: DiffType;
  char: string;
  oldIndex?: number;
  newIndex?: number;
  oldLineIndex?: number;
  newLineIndex?: number;
  oldCharIndexInLine?: number;
  newCharIndexInLine?: number;
}

export interface ApplyState {
  status?: "streaming" | "done" | "closed";
  numDiffs?: number;
  fileContent?: string;
  filepath?: string;
  streamId?: string;
  toolCallId?: string;
}

// File editor interface for VS Code integration
export interface FileEditor {
  readFile(filepath: string): Promise<string>;
  saveFile(filepath: string): Promise<void>;
  openFile(filepath: string): Promise<void>;
  getCurrentFile(): Promise<{ path: string } | undefined>;
}
