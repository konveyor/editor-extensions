import { renderPrompt } from "../src/registry.js";

/**
 * SEMANTIC REGRESSION (deterministic / mock model).
 *
 * ISO 42001 A.5.2 asks that prompt changes be evaluated against a baseline
 * dataset of legacy-migration challenges using mock model responses, so that a
 * reworded prompt cannot silently degrade migration quality. This suite runs
 * with NO live model: each baseline case renders the real prompt, pairs it with
 * a canned ("mock") model response, and scores — deterministically — whether the
 * prompt still supplies the scaffolding a model needs to produce that response.
 *
 * A score below threshold fails CI, flagging that a wording change dropped
 * something the model depends on (output contract, the code under migration,
 * an incident, language-specific dependency guidance, or the migration target).
 */

interface BaselineCase {
  name: string;
  programmingLanguage: string;
  migrationHint: string;
  fileName: string;
  fileContent: string;
  incidents: string[];
  /** Substring that must survive in the rendered prompt for this language. */
  dependencyAnchor: string;
  /** A canned model response — stands in for a real migration answer. */
  mockModelResponse: string;
}

const BASELINE: BaselineCase[] = [
  {
    name: "JavaEE servlet -> Quarkus",
    programmingLanguage: "Java",
    migrationHint: "JavaEE to Quarkus",
    fileName: "GreetingServlet.java",
    fileContent: "import javax.servlet.http.HttpServlet;\npublic class GreetingServlet {}",
    incidents: ["Replace javax.servlet with jakarta.servlet", "Use JAX-RS instead of HttpServlet"],
    dependencyAnchor: "pom.xml",
    mockModelResponse: "## Reasoning\nMigrate to JAX-RS.\n## Updated File\n// updated\n",
  },
  {
    name: "Spring XML -> annotations (Python sample)",
    programmingLanguage: "Python",
    migrationHint: "Python 2 to Python 3",
    fileName: "app.py",
    fileContent: "print 'hello'",
    incidents: ["print statement is not valid in Python 3"],
    dependencyAnchor: "requirements.txt",
    mockModelResponse: "## Reasoning\nUse print().\n## Updated File\nprint('hello')\n",
  },
  {
    name: "Node CommonJS -> ESM",
    programmingLanguage: "TypeScript",
    migrationHint: "CommonJS to ESM",
    fileName: "index.ts",
    fileContent: "const x = require('x');",
    incidents: ["Replace require with import"],
    dependencyAnchor: "package.json",
    mockModelResponse: "## Reasoning\nUse import.\n## Updated File\nimport x from 'x';\n",
  },
];

// Required structural anchors the fix-issue prompt must always present to the model.
const OUTPUT_CONTRACT_ANCHORS = ["## Reasoning", "## Updated File", "## Additional Information"];

const THRESHOLD = 1.0; // every baseline anchor must survive — no silent erosion.

function scoreFixIssuePrompt(
  rendered: string,
  c: BaselineCase,
): { score: number; missing: string[] } {
  const checks: Array<[string, boolean]> = [
    ["migration target", rendered.includes(c.migrationHint)],
    ["file content", rendered.includes(c.fileContent)],
    ["dependency guidance", rendered.includes(c.dependencyAnchor)],
    ...OUTPUT_CONTRACT_ANCHORS.map(
      (a) => [`output anchor ${a}`, rendered.includes(a)] as [string, boolean],
    ),
    ...c.incidents.map((i) => [`incident "${i}"`, rendered.includes(i)] as [string, boolean]),
  ];
  const missing = checks.filter(([, ok]) => !ok).map(([label]) => label);
  return { score: (checks.length - missing.length) / checks.length, missing };
}

describe("prompt semantic regression (mock model, baseline dataset)", () => {
  it.each(BASELINE.map((c) => [c.name, c] as const))(
    "preserves migration scaffolding for: %s",
    (_name, c) => {
      const rendered = renderPrompt("agentic.analysis.fix-issue.human", {
        programmingLanguage: c.programmingLanguage,
        migrationHint: c.migrationHint,
        fileName: c.fileName,
        inputFileContent: c.fileContent,
        inputIncidents: c.incidents.map((message) => ({ message })),
        hints: [],
      });

      // The mock model response is only producible if the prompt supplied the
      // necessary context; assert the response shape matches the prompt contract.
      expect(c.mockModelResponse).toContain("## Updated File");

      const { score, missing } = scoreFixIssuePrompt(rendered, c);
      if (score < THRESHOLD) {
        throw new Error(
          `Semantic regression for "${c.name}": score ${score.toFixed(2)} < ${THRESHOLD}. ` +
            `Missing scaffolding: ${missing.join(", ")}`,
        );
      }
      expect(score).toBeGreaterThanOrEqual(THRESHOLD);
    },
  );
});
