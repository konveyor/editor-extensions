import { GetSolutionResult, RuleSet, Solution, SolutionResponse } from "@editor-extensions/shared";
import { Uri } from "vscode";

const isString = (obj: unknown): obj is string => typeof obj === "string";
const isEmpty = (obj: unknown) => isObject(obj) && Object.keys(obj).length === 0;
const isObject = (obj: unknown): obj is object => typeof obj === "object";

export function isGetSolutionResult(object: unknown): object is GetSolutionResult {
  if (!object || typeof object !== "object") {
    return false;
  }

  const { encountered_errors, changes, scope, ...rest } = object as GetSolutionResult;

  return (
    Array.isArray(encountered_errors) &&
    Array.isArray(changes) &&
    isObject(scope) &&
    isEmpty(rest) &&
    encountered_errors.every(isString) &&
    changes.every(isObject) &&
    changes.every(
      ({ diff, original, modified, ...rest }) =>
        isEmpty(rest) && isString(diff) && isString(original) && isString(modified),
    )
  );
}

export function isAnalysis(obj: unknown): obj is RuleSet {
  const knownKeys: { [key in keyof RuleSet]: string } = {
    name: "string",
    description: "string",
    tags: "object",
    violations: "object",
    insights: "object",
    errors: "object",
    unmatched: "object",
    skipped: "object",
  };

  const knownKeysAsString = knownKeys as Record<string, string>;

  return (
    isObject(obj) &&
    !isEmpty(obj) &&
    Object.entries(obj).every(
      ([key, value]) => !knownKeysAsString[key] || typeof value === knownKeysAsString[key],
    )
  );
}

export function isAnalysisResponse(obj: unknown[]): obj is RuleSet[] {
  return Array.isArray(obj) && obj.every((item) => isAnalysis(item));
}

export function isUri(obj: unknown): obj is Uri {
  if (!isObject(obj)) {
    return false;
  }
  const uri = obj as Uri;
  return !!(uri["toJSON"] && uri["with"] && uri.scheme);
}

export function isSolutionResponse(obj: unknown): obj is SolutionResponse {
  const response = obj as SolutionResponse;
  return isString(response.diff) && Array.isArray(response.modified_files);
}

export function isSolution(obj: unknown): obj is Solution {
  return isGetSolutionResult(obj) || isSolutionResponse(obj);
}
