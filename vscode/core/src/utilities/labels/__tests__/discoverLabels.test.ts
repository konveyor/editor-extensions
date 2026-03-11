import expect from "expect";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { discoverLabels } from "../discoverLabels";

describe("discoverLabels", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "konveyor-labels-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should return empty arrays when directory does not exist", async () => {
    const result = await discoverLabels(path.join(tempDir, "nonexistent"));
    expect(result).toEqual({ targets: [], sources: [] });
  });

  it("should return empty arrays when directory has no yaml files", async () => {
    const result = await discoverLabels(tempDir);
    expect(result).toEqual({ targets: [], sources: [] });
  });

  it("should extract target and source labels from yaml files", async () => {
    await fs.writeFile(
      path.join(tempDir, "rule1.yaml"),
      `- labels:
    - konveyor.io/target=quarkus
    - konveyor.io/source=java-ee
`,
    );

    const result = await discoverLabels(tempDir);
    expect(result.targets).toEqual(["quarkus"]);
    expect(result.sources).toEqual(["java-ee"]);
  });

  it("should deduplicate labels across multiple files", async () => {
    await fs.writeFile(
      path.join(tempDir, "rule1.yaml"),
      `- labels:
    - konveyor.io/target=quarkus
    - konveyor.io/source=java-ee
`,
    );
    await fs.writeFile(
      path.join(tempDir, "rule2.yaml"),
      `- labels:
    - konveyor.io/target=quarkus
    - konveyor.io/source=eap
`,
    );

    const result = await discoverLabels(tempDir);
    expect(result.targets).toEqual(["quarkus"]);
    expect(result.sources).toEqual(["eap", "java-ee"]);
  });

  it("should handle + and - suffixed label values", async () => {
    await fs.writeFile(
      path.join(tempDir, "rule.yaml"),
      `- labels:
    - konveyor.io/target=spring-boot3+
    - konveyor.io/target=spring6+
    - konveyor.io/source=eap7.0-
    - konveyor.io/source=spring-boot2
`,
    );

    const result = await discoverLabels(tempDir);
    expect(result.targets).toEqual(["spring-boot3+", "spring6+"]);
    expect(result.sources).toEqual(["eap7.0-", "spring-boot2"]);
  });

  it("should sort results alphabetically", async () => {
    await fs.writeFile(
      path.join(tempDir, "rule.yaml"),
      `- labels:
    - konveyor.io/target=quarkus
    - konveyor.io/target=eap8
    - konveyor.io/target=azure-aks
`,
    );

    const result = await discoverLabels(tempDir);
    expect(result.targets).toEqual(["azure-aks", "eap8", "quarkus"]);
  });

  it("should scan nested subdirectories", async () => {
    const subDir = path.join(tempDir, "spring-boot");
    await fs.mkdir(subDir, { recursive: true });
    await fs.writeFile(
      path.join(subDir, "rule.yaml"),
      `- labels:
    - konveyor.io/target=spring-boot3+
`,
    );

    const result = await discoverLabels(tempDir);
    expect(result.targets).toEqual(["spring-boot3+"]);
  });
});

describe("discoverLabels against real rulesets", () => {
  const rulesetsDir = path.resolve(__dirname, "../../../../../../downloaded_assets/rulesets");

  let rulesetsExist = false;

  before(async () => {
    try {
      await fs.access(rulesetsDir);
      rulesetsExist = true;
    } catch {
      rulesetsExist = false;
    }
  });

  it("should discover the same labels as a naive line-by-line scan", async function (this: Mocha.Context) {
    if (!rulesetsExist) {
      this.skip();
    }

    // Independent reference implementation: line-by-line scan using a
    // deliberately different regex than discoverLabels to cross-validate.
    const TARGET_RE = /konveyor\.io\/target=(\S+)/;
    const SOURCE_RE = /konveyor\.io\/source=(\S+)/;
    const refTargets = new Set<string>();
    const refSources = new Set<string>();

    const dirEntries = await fs.readdir(rulesetsDir, { recursive: true });
    const yamlFiles = dirEntries
      .filter((e) => e.endsWith(".yaml"))
      .map((e) => path.join(rulesetsDir, e));

    for (const file of yamlFiles) {
      let content: string;
      try {
        content = await fs.readFile(file, "utf-8");
      } catch {
        continue; // skip directories or unreadable entries
      }
      const lines = content.split("\n");
      for (const line of lines) {
        const tm = line.match(TARGET_RE);
        if (tm) {
          refTargets.add(tm[1]);
        }
        const sm = line.match(SOURCE_RE);
        if (sm) {
          refSources.add(sm[1]);
        }
      }
    }

    const result = await discoverLabels(rulesetsDir);

    const discoveredTargetSet = new Set(result.targets);
    const discoveredSourceSet = new Set(result.sources);

    // Same number of unique labels
    expect(discoveredTargetSet.size).toBe(refTargets.size);
    expect(discoveredSourceSet.size).toBe(refSources.size);

    // Every reference label is present in our result
    for (const t of refTargets) {
      expect(discoveredTargetSet.has(t)).toBe(true);
    }
    for (const s of refSources) {
      expect(discoveredSourceSet.has(s)).toBe(true);
    }

    // Verify Spring targets are present (the original motivation)
    expect(discoveredTargetSet.has("spring-boot3+")).toBe(true);
    expect(discoveredTargetSet.has("spring6+")).toBe(true);
    expect(discoveredTargetSet.has("spring-security6+")).toBe(true);
    expect(discoveredSourceSet.has("spring-boot2")).toBe(true);
    expect(discoveredSourceSet.has("spring5")).toBe(true);
  });
});
