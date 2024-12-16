import * as vscode from "vscode";
import * as fs from "fs";
import * as yaml from "js-yaml";
import { RuleSet, Category, Incident } from "@editor-extensions/shared";
import { Immutable } from "immer";

//Assuming that output is in form of yaml
export function readYamlFile(filePath: string): RuleSet[] | undefined {
  try {
    const fileContents = fs.readFileSync(filePath, "utf8");
    const data = yaml.load(fileContents);
    if (Array.isArray(data)) {
      return data as RuleSet[];
    } else {
      console.error("YAML content is not an array of rulesets");
      return undefined;
    }
  } catch (e) {
    console.error("Error reading YAML file:", e);
    return undefined;
  }
}

function getSeverityFromCategory(category: Category | undefined): vscode.DiagnosticSeverity {
  switch (category) {
    case "mandatory":
      return vscode.DiagnosticSeverity.Error;
    case "optional":
      return vscode.DiagnosticSeverity.Warning;
    case "potential":
      return vscode.DiagnosticSeverity.Hint;
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}

export const processIncidents = (
  ruleSets: Immutable<RuleSet[]>,
): ReadonlyArray<[vscode.Uri, vscode.Diagnostic[]]> =>
  ruleSets
    .flatMap((ruleSet) => Object.values(ruleSet.violations ?? {}))
    .flatMap((violation): [vscode.DiagnosticSeverity, Incident][] => {
      const severity = getSeverityFromCategory(violation.category);
      return violation.incidents.map((it) => [severity, it]);
    })
    .filter(([, incident]) => incident.uri)
    .map(([severity, incident]) => {
      const uri = vscode.Uri.parse(incident.uri);
      const line = (incident.lineNumber || 1) - 1;
      const message = incident.message || "No message provided";
      const range = new vscode.Range(line, 0, line, 0);

      const diagnostic = new vscode.Diagnostic(range, message, severity);

      diagnostic.source = "konveyor";
      if (incident.codeSnip) {
        diagnostic.code = incident.codeSnip;
      }

      return [uri, [diagnostic]];
    });
