// processes a ModifiedFile message from agents
// 1. stores the state of the edit in a map to be reverted later
// 2. dependending on type of the file being modified:
//    a. For a build file, applies the edit directly to disk

import { KaiModifiedFile } from "@editor-extensions/agentic";
import { ModifiedFileState, normalizeLineEndings } from "@editor-extensions/shared";
import { Uri, workspace } from "vscode";

//    b. For a non-build file, applies the edit to the file in-memory
export async function processModifiedFile(
  modifiedFilesState: Map<string, ModifiedFileState>,
  modifiedFile: KaiModifiedFile,
  eventEmitter?: { emit: (event: string, ...args: any[]) => void },
): Promise<void> {
  const { path, content } = modifiedFile;
  const uri = Uri.file(path);
  const alreadyModified = modifiedFilesState.has(uri.fsPath);

  // Normalize line endings to LF to prevent CRLF-related diff issues
  // This is critical for cross-platform compatibility and proper diff rendering
  const normalizedContent = normalizeLineEndings(content);

  // check if this is a newly created file
  let isNew = false;
  let originalContent: undefined | string = undefined;
  if (!alreadyModified) {
    try {
      await workspace.fs.stat(uri);
    } catch (err) {
      if ((err as any).code === "FileNotFound" || (err as any).name === "EntryNotFound") {
        isNew = true;
      } else {
        throw err;
      }
    }
    // Normalize original content as well to ensure consistent comparison
    const rawOriginal = isNew
      ? undefined
      : new TextDecoder().decode(await workspace.fs.readFile(uri));
    originalContent = rawOriginal ? normalizeLineEndings(rawOriginal) : undefined;

    modifiedFilesState.set(uri.fsPath, {
      modifiedContent: normalizedContent,
      originalContent,
      editType: "inMemory", // Default value to satisfy type requirement
    });

    // Emit event when a file is added to modifiedFiles
    if (eventEmitter) {
      eventEmitter.emit("modifiedFileAdded", uri.fsPath);
    }
  } else {
    const existingState = modifiedFilesState.get(uri.fsPath);
    if (existingState) {
      modifiedFilesState.set(uri.fsPath, {
        ...existingState,
        modifiedContent: normalizedContent,
      });

      // Emit event when a file is updated in modifiedFiles
      if (eventEmitter) {
        eventEmitter.emit("modifiedFileUpdated", uri.fsPath);
      }
    } else {
      console.error(`No existing state found for ${uri.fsPath}, cannot update content.`);
      return;
    }
  }
  // Skip applying any edits to prevent modifying files or opening in editor
  console.log(`Skipping edit for ${uri.fsPath} to avoid modifying file or opening in editor`);
}
