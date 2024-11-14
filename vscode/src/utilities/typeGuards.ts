import { GetSolutionResult, RuleSet } from "@editor-extensions/shared";
import { Uri } from "vscode";

const isString = (obj: unknown): obj is string => typeof obj === "string";
const isEmpty = (obj: unknown) => isObject(obj) && Object.keys(obj).length === 0;
const isObject = (obj: unknown): obj is object => typeof obj === "object";

export function isSolution(object: unknown): object is GetSolutionResult {
  if (!object || typeof object !== "object") {
    return false;
  }

  const { errors, changes, ...rest } = object as GetSolutionResult;

  return (
    Array.isArray(errors) &&
    Array.isArray(changes) &&
    isEmpty(rest) &&
    errors.every(isString) &&
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

  return (
    isObject(obj) &&
    !isEmpty(obj) &&
    Object.entries(obj).every(
      ([key, value]) => typeof value === (knownKeys as Record<string, string>)[key],
    )
  );
}

export function isUri(obj: unknown): obj is Uri {
  if (!isObject(obj)) {
    return false;
  }
  const uri = obj as Uri;
  return !!(uri["toJSON"] && uri["with"] && uri.scheme);
}
