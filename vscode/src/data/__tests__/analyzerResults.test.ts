import assert from "assert";
import path from "path";
import { DiagnosticSeverity } from "vscode";
import { processIncidents, readYamlFile } from "../analyzerResults";
import { RuleSet, EnhancedIncident } from "@editor-extensions/shared";

describe("analyzer results tests", () => {
  describe("processIncidents should populate diagnostics correctly", () => {
    const filePath = path.resolve(__dirname, "./testData/output-data.yaml");
    const ruleSets: RuleSet[] | undefined = readYamlFile(filePath);
    it("RuleSets should be loaded from YAML file", () => {
      assert.ok(ruleSets, "RuleSets should be loaded from YAML file");
    });

    // Transform RuleSets into EnhancedIncidents
    const enhancedIncidents: EnhancedIncident[] = ruleSets!.flatMap((ruleSet) =>
      Object.entries(ruleSet.violations ?? {}).flatMap(([violationId, violation]) =>
        violation.incidents.map((incident) => ({
          ...incident,
          violationId,
          ruleset_name: ruleSet.name,
          ruleset_description: ruleSet.description,
          violation_name: violationId,
          violation_description: violation.description,
          violation_category: violation.category,
          violation_labels: violation.labels,
        })),
      ),
    );

    const results = processIncidents(enhancedIncidents);

    // normalize to posix path for comparison
    const receivedPaths = results.map(([uri]) => uri.fsPath?.split(path.sep).join("/"));
    const expectedPaths = ["", "", "", ""];
    expectedPaths.fill("/opt/input/source/src/main/webapp/WEB-INF/web.xml");

    it("web.xml should have 4 diagnostics", () => {
      assert.deepStrictEqual(receivedPaths, expectedPaths, "web.xml should have 4 diagnostics");
      assert.ok(
        results
          .flatMap(([, diagnostics]) => diagnostics)
          .every((diagnostic) => diagnostic?.severity === DiagnosticSeverity.Error),
        "Diagnostic severity for web.xml should be Error",
      );
    });

    // Test that diagnostics contain the enhanced information
    const diagnostics = results.flatMap(([, diagnostics]) => diagnostics);
    for (const diagnostic of diagnostics) {
      it("Diagnostics should contain enhanced context information", () => {
        const isEnhanced =
          // diagnostic.relatedInformation?.length === 1 &&
          diagnostic.message.includes("Ruleset:") &&
          diagnostic.message.includes("Violation:") &&
          diagnostic.message.includes("Category:");

        assert.ok(isEnhanced);
      });
    }
  });
});
