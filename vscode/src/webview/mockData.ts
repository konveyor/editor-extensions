// import { Incident, RuleSet } from "./types";

// function generateRandomIncident(violationId: string, index: number): Incident {
//   const severities = ["High", "Medium", "Low"];
//   const files = [
//     "/Users/ibolton/Development/tackle-testapp-public/configuration-utils/src/main/java/io/konveyor/demo/config/ApplicationConfiguration.java",
//     "/Users/ibolton/Development/tackle-testapp-public/src/main/java/io/konveyor/demo/ordermanagement/model/Customer.java",
//   ];

//   const fileLineNumbers: { [key: string]: number[] } = {
//     "/Users/ibolton/Development/tackle-testapp-public/configuration-utils/src/main/java/io/konveyor/demo/config/ApplicationConfiguration.java":
//       [8, 12, 16, 20, 24],
//     "/Users/ibolton/Development/tackle-testapp-public/src/main/java/io/konveyor/demo/ordermanagement/model/Customer.java":
//       [5, 10, 15, 20, 25, 30],
//   };

//   const selectedFile = files[Math.floor(Math.random() * files.length)];
//   const lineNumbers = fileLineNumbers[selectedFile] || [1, 2, 3, 4, 5];

//   return {
//     id: `${violationId}-${index}`,
//     file: selectedFile,
//     line: lineNumbers[Math.floor(Math.random() * lineNumbers.length)],
//     severity: severities[Math.floor(Math.random() * severities.length)] as
//       | "High"
//       | "Medium"
//       | "Low",
//     message: `Mock incident ${index} for violation ${violationId}`,
//   };
// }

// export function generateMockRuleSet(): RuleSet {
//   const violations: { [key: string]: any } = {};
//   const violationTypes = [
//     "use-logging-framework",
//     "handle-exceptions-properly",
//     "avoid-hardcoded-credentials",
//     "use-prepared-statements",
//     "implement-proper-error-handling",
//     "avoid-null-pointer-exceptions",
//     "use-dependency-injection",
//     "implement-proper-authentication",
//     "use-secure-communication",
//     "implement-input-validation",
//   ];

//   violationTypes.forEach((violationType, index) => {
//     const violationId = `${violationType}-${index.toString().padStart(5, "0")}`;
//     const incidentCount = Math.floor(Math.random() * 20) + 5; // 5 to 24 incidents per violation

//     violations[violationId] = {
//       description: `${violationType.split("-").join(" ")} violation`,
//       category: index % 3 === 0 ? "mandatory" : index % 3 === 1 ? "potential" : "optional",
//       incidents: Array.from({ length: incidentCount }, (_, i) =>
//         generateRandomIncident(violationId, i),
//       ),
//     };
//   });

//   return {
//     name: "Mock RuleSet with Many Violations",
//     description: "This ruleset contains many violations to demonstrate scrolling",
//     violations: violations,
//   };
// }
