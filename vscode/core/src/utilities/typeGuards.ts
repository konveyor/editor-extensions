import { RuleSet } from "@editor-extensions/shared";
import { Uri } from "vscode";

const isEmpty = (obj: unknown) => isObject(obj) && Object.keys(obj).length === 0;
const isObject = (obj: unknown): obj is object => typeof obj === "object";

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
