import {
  GetSolutionResult,
  LocalChange,
  Solution,
  SolutionResponse,
} from "@editor-extensions/shared";
import { Uri, window, workspace } from "vscode";
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
  // TODO: implement logic for deleted/added files

  // create all the dirs synchronously
  localChanges.forEach(({ modifiedUri }) =>
    memFs.createDirectoriesIfNeeded(modifiedUri, KONVEYOR_SCHEME),
  );

  const writeDiff = async ({ diff, originalUri, modifiedUri }: LocalChange) => {
    const content = await applyDiff(originalUri, diff);
    memFs.writeFile(modifiedUri, Buffer.from(content), {
      create: true,
      overwrite: true,
    });
  };
  // write the content asynchronously (reading original file via VS Code is async)
  await Promise.all(localChanges.map((change) => writeDiff(change)));
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
