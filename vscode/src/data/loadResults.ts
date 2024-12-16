import {
  GetSolutionResult,
  LocalChange,
  RuleSet,
  Scope,
  Solution,
} from "@editor-extensions/shared";
import { processIncidents } from "./analyzerResults";
import { ExtensionState } from "src/extensionState";
import { deleteAllDataFilesByPrefix, writeDataFile } from "./storage";
import { toLocalChanges, writeSolutionsToMemFs } from "./virtualStorage";
import { Diagnostic, Uri, window } from "vscode";
import {
  KONVEYOR_SCHEME,
  MERGED_RULE_SET_DATA_FILE_PREFIX,
  PARTIAL_RULE_SET_DATA_FILE_PREFIX,
  RULE_SET_DATA_FILE_PREFIX,
  SOLUTION_DATA_FILE_PREFIX,
} from "../utilities";
import { castDraft, Immutable } from "immer";
import { mergeRuleSets } from "../analysis";

const diagnosticsForPaths = (
  filePaths: Uri[],
  diagnostics: Immutable<[Uri, Diagnostic[]][]>,
): [Uri, Diagnostic[]][] => {
  const paths = new Set(filePaths.map((it) => it.toString()));
  return diagnostics.filter(([uri]) => paths.has(uri.toString())) as [Uri, Diagnostic[]][];
};

const countDiagnosticPerPath = (diagnostics: [Uri, readonly Diagnostic[] | undefined][]) =>
  diagnostics.reduce(
    (acc, [uri, items]) => {
      const path = uri.toString();
      acc[path] = (acc[path] ?? 0) + (items?.length ?? 0);
      return acc;
    },
    {} as { [key: string]: number },
  );

export const loadRuleSets = async (
  state: ExtensionState,
  receivedRuleSets: RuleSet[],
  filePaths?: Uri[],
) => {
  const isPartial = !!filePaths;
  if (isPartial) {
    //partial analysis
    await writeDataFile(receivedRuleSets, PARTIAL_RULE_SET_DATA_FILE_PREFIX);
  } else {
    //full analysis
    await writeDataFile(receivedRuleSets, RULE_SET_DATA_FILE_PREFIX);
    // cleanup
    await deleteAllDataFilesByPrefix(PARTIAL_RULE_SET_DATA_FILE_PREFIX);
    await deleteAllDataFilesByPrefix(MERGED_RULE_SET_DATA_FILE_PREFIX);
  }

  const data = state.mutateData((draft) => {
    draft.ruleSets = isPartial
      ? mergeRuleSets(draft.ruleSets, receivedRuleSets, filePaths)
      : receivedRuleSets;
  });
  const diagnosticTuples = processIncidents(data.ruleSets);
  if (isPartial) {
    await writeDataFile(data.ruleSets, MERGED_RULE_SET_DATA_FILE_PREFIX);
    console.log(
      "Diagnostics on the selected paths before update",
      countDiagnosticPerPath(filePaths.map((uri) => [uri, state.diagnosticCollection.get(uri)])),
    );
    const scopedChange = [
      // remove existing markers by passing undefined first
      ...filePaths.map((uri): [Uri, undefined] => [uri, undefined]),
      // set new values
      ...diagnosticsForPaths(filePaths, diagnosticTuples),
    ];
    state.diagnosticCollection.set(scopedChange);
    console.log(
      "Diagnostics on the selected paths after update",
      countDiagnosticPerPath(filePaths.map((uri) => [uri, state.diagnosticCollection.get(uri)])),
    );
  } else {
    state.diagnosticCollection.clear();
    state.diagnosticCollection.set(diagnosticTuples);
  }
};

export const cleanRuleSets = (state: ExtensionState) => {
  state.diagnosticCollection.clear();
  state.mutateData((draft) => {
    draft.ruleSets = [];
  });
};

export const loadSolution = async (state: ExtensionState, solution: Solution, scope?: Scope) => {
  await writeDataFile(solution, SOLUTION_DATA_FILE_PREFIX);
  await doLoadSolution(
    state,
    toLocalChanges(solution),
    solution,
    scope ?? (solution as GetSolutionResult).scope,
  );
};

export const reloadLastResolutions = async (state: ExtensionState) => {
  await doLoadSolution(
    state,
    state.data.localChanges.map((it) => ({ ...it, state: "pending" })),
    state.data.solutionData,
    state.data.solutionScope,
  );

  window.showInformationMessage(`Loaded last available resolutions`);
};

const doLoadSolution = async (
  state: ExtensionState,
  localChanges: LocalChange[],
  solution?: Immutable<Solution>,
  scope?: Immutable<Scope>,
) => {
  state.memFs.removeAll(KONVEYOR_SCHEME);
  await writeSolutionsToMemFs(localChanges, state);
  state.mutateData((draft) => {
    draft.localChanges = localChanges;
    draft.solutionData = castDraft(solution);
    draft.solutionScope = castDraft(scope);
  });
};
