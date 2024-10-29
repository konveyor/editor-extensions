import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import { processIncidents, readYamlFile } from "../client/analyzerResults";
import { RuleSet } from "@shared/types";

suite("Extension Test Suite", () => {
  test("processIncidents should populate diagnostics correctly", () => {
    const filePath = path.resolve(__dirname, "./testData/output-data.yaml");
    const ruleSets: RuleSet[] | undefined = readYamlFile(filePath);
    assert.ok(ruleSets, "RuleSets should be loaded from YAML file");
    const diagnosticsMap = new Map<string, vscode.Diagnostic[]>();
    processIncidents(ruleSets!, diagnosticsMap);
    assert.ok(
      diagnosticsMap.has("file:///opt/input/source/src/main/webapp/WEB-INF/web.xml"),
      "web.xml diagnostics should exist",
    );
    const diagnosticsFile = diagnosticsMap.get(
      "file:///opt/input/source/src/main/webapp/WEB-INF/web.xml",
    );
    assert.strictEqual(diagnosticsFile?.length, 4, "web.xml should have 4 diagnostics");
    assert.strictEqual(
      diagnosticsFile?.[0].severity,
      vscode.DiagnosticSeverity.Error,
      "Diagnostic severity for web.xml should be Error",
    );
  });
});
