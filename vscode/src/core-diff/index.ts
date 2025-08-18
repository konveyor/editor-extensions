/**
 * Minimal type definitions extracted from Continue's core module
 * These are the essential types needed for the vertical diff system
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

// Minimal types for IDE integration (subset of Continue's IDE interface)
export interface IDE {
  readFile(filepath: string): Promise<string>;
  saveFile(filepath: string): Promise<void>;
  openFile(filepath: string): Promise<void>;
  getCurrentFile(): Promise<{ path: string } | undefined>;
}

// Minimal ILLM interface for type compatibility
export interface ILLM {
  model: string;
  title?: string;
  contextLength: number;
  promptTemplates?: {
    apply?: string;
  };
  underlyingProviderName?: string;
  renderPromptTemplate?(template: string, history: any[], vars: any): string | any[];
}

// Rules for type compatibility
export interface RuleWithSource {
  id: string;
  name: string;
  description?: string;
}

// Chat message types for compatibility
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}
