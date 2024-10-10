import * as vscode from "vscode";
import * as fs from "fs";
import * as yaml from "js-yaml";
import { Category, RuleSet } from "./webview/types";

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
    case Category.Mandatory:
      return vscode.DiagnosticSeverity.Error;
    case Category.Optional:
      return vscode.DiagnosticSeverity.Warning;
    case Category.Potential:
      return vscode.DiagnosticSeverity.Hint;
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}

export function processIncidents(
  ruleSets: RuleSet[],
  diagnosticsMap: Map<string, vscode.Diagnostic[]>,
): void {
  diagnosticsMap.clear();

  ruleSets.forEach((ruleSet) => {
    for (const violationId in ruleSet.violations) {
      const violation = ruleSet.violations[violationId];
      const severity = getSeverityFromCategory(violation.category);

      violation.incidents.forEach((incident) => {
        if (incident.uri) {
          const uri = vscode.Uri.parse(incident.uri);
          const line = (incident.lineNumber || 1) - 1;
          const message = incident.message || "No message provided";
          const range = new vscode.Range(line, 0, line, 0);

          const diagnostic = new vscode.Diagnostic(range, message, severity);

          diagnostic.source = "konveyor";
          if (incident.codeSnip) {
            diagnostic.code = incident.codeSnip;
          }

          const fileUriString = uri.toString();
          let diagnosticsForFile = diagnosticsMap.get(fileUriString);

          if (!diagnosticsForFile) {
            diagnosticsForFile = [];
            diagnosticsMap.set(fileUriString, diagnosticsForFile);
          }

          diagnosticsForFile.push(diagnostic);
        }
      });
    }
  });
}
