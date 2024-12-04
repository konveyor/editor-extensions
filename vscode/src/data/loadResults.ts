import {
  GetSolutionResult,
  LocalChange,
  RuleSet,
  Scope,
  Solution,
} from "@editor-extensions/shared";
import { processIncidents } from "./analyzerResults";
import { ExtensionState } from "src/extensionState";
import { writeDataFile } from "./storage";
import { toLocalChanges, writeSolutionsToMemFs } from "./virtualStorage";
import { window } from "vscode";
import {
  KONVEYOR_SCHEME,
  RULE_SET_DATA_FILE_PREFIX,
  SOLUTION_DATA_FILE_PREFIX,
} from "../utilities";
import { castDraft, Immutable } from "immer";

export const loadRuleSets = async (state: ExtensionState, ruleSets: RuleSet[]) => {
  await writeDataFile(ruleSets, RULE_SET_DATA_FILE_PREFIX);
  state.diagnosticCollection.set(processIncidents(ruleSets));
  state.mutateData((draft) => {
    draft.ruleSets = ruleSets;
  });
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
