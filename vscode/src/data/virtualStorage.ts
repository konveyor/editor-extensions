import { GetSolutionResult } from "@shared/types";
import { Uri, window, workspace } from "vscode";
import { ExtensionState } from "src/extensionState";
import * as Diff from "diff";
import path from "path";

import { KONVEYOR_SCHEME, fromRelativeToKonveyor } from "../utilities";

export interface LocalChange {
  modifiedUri: Uri;
  originalUri: Uri;
  diff: string;
}

export const writeSolutionsToMemFs = async (
  solution: GetSolutionResult,
  { memFs }: ExtensionState,
) => {
  memFs.removeAll(KONVEYOR_SCHEME);
  // TODO: implement logic for deleted/added files
  const localChanges = solution.changes.map(({ modified, original, diff }) => ({
    modifiedUri: fromRelativeToKonveyor(modified),
    originalUri: Uri.from({
      scheme: "file",
      path: path.join(workspace.workspaceFolders?.[0].uri.fsPath ?? "", original),
    }),
    diff,
  }));

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
