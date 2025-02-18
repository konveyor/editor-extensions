import {
  GetSolutionResult,
  LocalChange,
  Solution,
  SolutionResponse,
} from "@editor-extensions/shared";
import { FileSystemError, Uri, window, workspace } from "vscode";
import { ExtensionState } from "src/extensionState";
import * as Diff from "diff";
import path from "path";

import {
  fromRelativeToKonveyor,
  isGetSolutionResult,
  isSolutionResponse,
  KONVEYOR_SCHEME,
} from "../utilities";
import { Immutable } from "immer";
import { paths } from "../paths";
import { MemFS } from "./fileSystemProvider";

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

export const writeSolutionsToMemFs = async (
  localChanges: Immutable<LocalChange[]>,
  { memFs }: ExtensionState,
) => {
  localChanges.forEach(({ modifiedUri }) => {
    memFs.createDirectoriesIfNeeded(modifiedUri, KONVEYOR_SCHEME);
  });

  await Promise.all(
    localChanges.map(async (change) => {
      const { diff, originalUri, modifiedUri } = change;

      try {
        const originalContent = await readFileFromMemFsOrOriginal(memFs, modifiedUri, originalUri);

        const patchedContent = Diff.applyPatch(originalContent, diff);
        if (patchedContent === false) {
          const msg = `Failed to apply solution diff for ${modifiedUri.path}`;
          window.showErrorMessage(msg);
          console.error(`${msg}\nSolution diff:\n${diff}`);
          return;
        }

        memFs.writeFile(modifiedUri, Buffer.from(patchedContent), {
          create: true,
          overwrite: true,
        });
      } catch (error) {
        const msg = `Unexpected error writing diff for ${modifiedUri.path}: ${String(error)}`;
        window.showErrorMessage(msg);
        console.error(msg);
      }
    }),
  );

  return localChanges;
};

async function readFileFromMemFsOrOriginal(
  memFs: MemFS,
  modifiedUri: Uri,
  originalUri: Uri,
): Promise<string> {
  try {
    const memFsBuffer = await memFs.readFile(modifiedUri);
    return memFsBuffer.toString();
  } catch (error) {
    if (error instanceof FileSystemError && error.code === "FileNotFound") {
      const originalBuffer = await workspace.fs.readFile(originalUri);
      return originalBuffer.toString();
    } else {
      throw error;
    }
  }
}
