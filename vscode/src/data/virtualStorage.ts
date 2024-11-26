import { LocalChange, SolutionResponse } from "@editor-extensions/shared";
import { Uri, window, workspace } from "vscode";
import { ExtensionState } from "src/extensionState";
import * as Diff from "diff";
import path from "path";

import { KONVEYOR_SCHEME } from "../utilities";
import { Immutable } from "immer";

export const fromRelativeToKonveyor = (relativePath: string) =>
  Uri.from({ scheme: KONVEYOR_SCHEME, path: path.posix.sep + relativePath });
//this is what the url looks like
const url =
  "/Users/ibolton/Development/coolstore/Users/ibolton/Development/coolstore/src/main/java/com/redhat/coolstore/service/InventoryNotificationMDB.java";

//trying to pass in SolutionResult here
export const toLocalChanges = (solution: SolutionResponse): LocalChange[] => {
  if (solution.modified_files.length !== 1) {
    console.error("Expected exactly one modified file");
    return [];
  }

  const modifiedFilePath = solution.modified_files[0];

  // Parse the diff to extract file changes
  const parsedPatches = Diff.parsePatch(solution.diff);

  if (parsedPatches.length !== 1) {
    console.error("Expected exactly one patch in the diff");
    return [];
  }

  const parsedPatch = parsedPatches[0];

  // Reconstruct the diff for this file
  const diff = Diff.formatPatch([parsedPatch]);

  // Get the workspace path
  const workspacePath = workspace.workspaceFolders?.[0].uri.fsPath ?? "";

  // Ensure modifiedFilePath is an absolute path
  const isModifiedPathAbsolute = path.isAbsolute(modifiedFilePath);

  // Construct originalUri
  const originalUri = Uri.file(modifiedFilePath);

  // Compute relative path from workspace root to the modified file
  const relativePath = path.relative(workspacePath, modifiedFilePath);

  // Construct modifiedUri using your custom function
  const modifiedUri = fromRelativeToKonveyor(relativePath);

  // Log paths for debugging
  console.log("Modified file path:", modifiedFilePath);
  console.log("Workspace path:", workspacePath);
  console.log("Relative path:", relativePath);
  console.log("Original URI:", originalUri.toString());
  console.log("Modified URI:", modifiedUri.toString());

  return [
    {
      modifiedUri,
      originalUri,
      diff,
      state: "pending",
    },
  ];
};

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
