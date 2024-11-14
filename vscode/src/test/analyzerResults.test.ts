import * as assert from "assert";
import { DiagnosticSeverity } from "vscode";
import * as path from "path";
import { processIncidents, readYamlFile } from "../data/analyzerResults";
import { RuleSet } from "@editor-extensions/shared";

suite("Extension Test Suite", () => {
  test("processIncidents should populate diagnostics correctly", () => {
    const filePath = path.resolve(__dirname, "./testData/output-data.yaml");
    const ruleSets: RuleSet[] | undefined = readYamlFile(filePath);
    assert.ok(ruleSets, "RuleSets should be loaded from YAML file");
    const results = processIncidents(ruleSets!);
    // normalize to posix path for comparison
    const receivedPaths = results.map(([uri]) => uri.fsPath?.split(path.sep).join("/"));
    const expectedPaths = ["", "", "", ""];
    expectedPaths.fill("/opt/input/source/src/main/webapp/WEB-INF/web.xml");

    assert.deepStrictEqual(receivedPaths, expectedPaths, "web.xml should have 4 diagnostics");
    assert.ok(
      results
        .flatMap(([, diagnostics]) => diagnostics)
        .every((diagnostic) => diagnostic?.severity === DiagnosticSeverity.Error),
      "Diagnostic severity for web.xml should be Error",
    );
  });
});
