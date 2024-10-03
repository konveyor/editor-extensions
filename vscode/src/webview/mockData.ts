import { Incident, RuleSet } from "./types";

function generateRandomIncident(violationId: string, index: number): Incident {
  const severities = ["High", "Medium", "Low"];
  const files = [
    "/src/main/java/com/example/App.java",
    "/src/main/java/com/example/Service.java",
    "/src/main/java/com/example/Repository.java",
    "/src/main/java/com/example/Controller.java",
    "/src/main/java/com/example/Model.java",
  ];

  return {
    id: `${violationId}-${index}`,
    file: files[Math.floor(Math.random() * files.length)],
    line: Math.floor(Math.random() * 1000) + 1,
    severity: severities[Math.floor(Math.random() * severities.length)] as
      | "High"
      | "Medium"
      | "Low",
    message: `Mock incident ${index} for violation ${violationId}`,
  };
}

export function generateMockRuleSet(): RuleSet {
  const violations: { [key: string]: any } = {};
  const violationTypes = [
    "use-logging-framework",
    "handle-exceptions-properly",
    "avoid-hardcoded-credentials",
    "use-prepared-statements",
    "implement-proper-error-handling",
    "avoid-null-pointer-exceptions",
    "use-dependency-injection",
    "implement-proper-authentication",
    "use-secure-communication",
    "implement-input-validation",
  ];

  violationTypes.forEach((violationType, index) => {
    const violationId = `${violationType}-${index.toString().padStart(5, "0")}`;
    const incidentCount = Math.floor(Math.random() * 20) + 5; // 5 to 24 incidents per violation

    violations[violationId] = {
      description: `${violationType.split("-").join(" ")} violation`,
      category: index % 3 === 0 ? "mandatory" : index % 3 === 1 ? "potential" : "optional",
      incidents: Array.from({ length: incidentCount }, (_, i) =>
        generateRandomIncident(violationId, i),
      ),
    };
  });

  return {
    name: "Mock RuleSet with Many Violations",
    description: "This ruleset contains many violations to demonstrate scrolling",
    violations: violations,
  };
}
