import {
  GetSolutionResult,
  LocalChange,
  Solution,
  SolutionResponse,
} from "@editor-extensions/shared";
import {
  CancellationToken,
  Event,
  ProviderResult,
  TextDocumentContentProvider,
  Uri,
  window,
  workspace,
} from "vscode";
import { ExtensionState } from "src/extensionState";
import * as Diff from "diff";
import path from "path";

import { fromRelativeToKonveyor, isGetSolutionResult, isSolutionResponse } from "../utilities";
import { Immutable } from "immer";
import { paths } from "../paths";

export const toLocalChanges = (solution: Solution): LocalChange[] => {
  if (isGetSolutionResult(solution)) {
    return toLocalFromGetSolutionResult(solution);
  }
  if (isSolutionResponse(solution)) {
    return toLocalFromSolutionResponse(solution);
  }
  return [];
};

const toAbsolutePathInsideWorkspace = (relativePath: string) =>
  path.join(paths().workspaceRepo.fsPath ?? "", relativePath);

const toLocalFromGetSolutionResult = (solution: GetSolutionResult): LocalChange[] =>
  solution.changes
    // drop add/delete/rename changes (no support as for now)
    .filter(({ modified, original }) => modified && original && modified === original)
    .map(({ modified, original, diff }) => ({
      modifiedUri: fromRelativeToKonveyor(modified),
      originalUri: Uri.file(toAbsolutePathInsideWorkspace(original)),
      diff,
      state: "pending",
    }));

const toLocalFromSolutionResponse = (solution: SolutionResponse): LocalChange[] =>
  Diff.parsePatch(solution.diff)
    .map((it, index) => {
      console.log(`diff no ${index}`, it);
      return it;
    })
    // drop add/delete/rename changes (no support as for now)
    .filter(
      ({ newFileName, oldFileName }) =>
        oldFileName?.startsWith("a/") &&
        newFileName?.startsWith("b/") &&
        oldFileName.substring(2) === newFileName.substring(2),
    )
    .map((structuredPatch) => ({
      modifiedUri: fromRelativeToKonveyor(structuredPatch.oldFileName!.substring(2)),
      originalUri: Uri.file(
        toAbsolutePathInsideWorkspace(structuredPatch.oldFileName!.substring(2)),
      ),
      diff: Diff.formatPatch(structuredPatch),
      state: "pending",
    }));

// Class to manage the virtual file content
export class VirtualFileSystem implements TextDocumentContentProvider {
  private static instance: VirtualFileSystem;
  private contentMap: Map<string, string> = new Map();

  // Event to signal when content has changed
  onDidChange?: Event<Uri> | undefined;

  private constructor() {
    // No need to register here, we'll register in register.ts
  }

  // Implement the TextDocumentContentProvider interface
  provideTextDocumentContent(uri: Uri, _token: CancellationToken): ProviderResult<string> {
    return this.contentMap.get(uri.toString()) || "";
  }

  public static getInstance(): VirtualFileSystem {
    if (!VirtualFileSystem.instance) {
      VirtualFileSystem.instance = new VirtualFileSystem();
    }
    return VirtualFileSystem.instance;
  }

  public setContent(uri: Uri, content: string): void {
    this.contentMap.set(uri.toString(), content);
  }

  public getContent(uri: Uri): string | undefined {
    return this.contentMap.get(uri.toString());
  }

  public dispose(): void {
    this.contentMap.clear();
  }

  public removeAll(scheme: string): void {
    // Remove all entries with the specified scheme
    for (const uriString of this.contentMap.keys()) {
      try {
        const uri = Uri.parse(uriString);
        if (uri.scheme === scheme) {
          this.contentMap.delete(uriString);
        }
      } catch (error) {
        console.error(`Error parsing URI: ${uriString}`, error);
      }
    }
  }
}

export const writeSolutionsToMemFs = async (
  localChanges: Immutable<LocalChange[]>,
  _state: ExtensionState, // We don't need to destructure memFs anymore
) => {
  // Get the virtual file system instance
  const virtualFs = VirtualFileSystem.getInstance();

  // Process each local change
  for (const change of localChanges) {
    try {
      // Apply the diff to get the modified content
      const content = await applyDiff(change.originalUri, change.diff);

      // Store the modified content in the virtual file system
      virtualFs.setContent(change.modifiedUri, content);
    } catch (error) {
      console.error(`Error processing change for ${change.originalUri.path}:`, error);
      window.showErrorMessage(`Failed to process change for ${change.originalUri.path}`);
    }
  }

  return localChanges;
};

const applyDiff = async (original: Uri, diff: string) => {
  const source = await workspace.fs.readFile(original);
  const computed = Diff.applyPatch(source.toString(), diff);
  if (computed === false) {
    const msg = `Failed to apply solution diff for ${original.path}`;
    window.showErrorMessage(msg);
    console.error(`${msg}\nSolution diff:\n${diff}`);
  }

  return computed || diff;
};
