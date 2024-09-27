import { Incident } from "./webview/types";

export function generateMockIncidentData(): Incident[] {
  const mockData = [
    {
      id: "0000",
      name: "configuration-utils",
      rulesets: [
        {
          name: "java/code-quality",
          description:
            "This ruleset analyzes Java applications for best practices and code quality improvements.",
          violations: {
            "use-logging-framework-00001": {
              description:
                "Replace System.out.println statements with a logging framework.",
              category: "mandatory",
              labels: [
                "konveyor.io/source",
                "konveyor.io/target=java",
                "konveyor.io/category=logging",
              ],
              incidents: [
                {
                  uri: "file:///Users/ibolton/Development/tackle-testapp-public/configuration-utils/src/main/java/io/konveyor/demo/config/ApplicationConfiguration.java",
                  message:
                    "Replace `System.out.println` with a logging framework for better flexibility and control over logging levels.",
                  lineNumber: 20, // Assuming line 20 contains System.out.println
                  variables: {
                    matchingText: "System.out.println",
                  },
                },
              ],
              effort: 1,
            },
            "handle-exceptions-properly-00002": {
              description:
                "Handle exceptions appropriately instead of using generic catch blocks.",
              category: "potential",
              labels: [
                "konveyor.io/source",
                "konveyor.io/target=java",
                "konveyor.io/category=exception-handling",
              ],
              incidents: [
                {
                  uri: "file:///Users/ibolton/Development/tackle-testapp-public/configuration-utils/src/main/java/io/konveyor/demo/config/ApplicationConfiguration.java",
                  message:
                    "Consider handling specific exceptions or rethrowing them after logging.",
                  lineNumber: 17, // Assuming line 17 contains 'catch (Exception e)'
                  variables: {
                    matchingText: "catch (Exception e)",
                  },
                },
              ],
              effort: 2,
            },
          },
        },
      ],
      depItems: [
        {
          fileURI:
            "file:///Users/ibolton/Development/tackle-testapp-public/configuration-utils/pom.xml",
          provider: "java",
          dependencies: [],
        },
      ],
    },
  ];

  const incidents: Incident[] = [];

  mockData.forEach((app) => {
    app.rulesets.forEach((ruleset) => {
      if (ruleset.violations) {
        Object.values(ruleset.violations).forEach((violation: any) => {
          violation.incidents.forEach((incident: any) => {
            incidents.push({
              id: `${incident.uri}:${incident.lineNumber}`,
              file: incident.uri,
              line: incident.lineNumber,
              severity:
                violation.category === "mandatory"
                  ? "High"
                  : violation.category === "potential"
                  ? "Medium"
                  : "Low",
              message: incident.message,
              // Include additional fields if needed
            });
          });
        });
      }
    });
  });

  return incidents;
}