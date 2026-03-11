import expect from "expect";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
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

  it("should discover the same labels as grep", async function (this: Mocha.Context) {
    if (!rulesetsExist) {
      this.skip();
    }

    // Use grep --include to match only *.yaml files, same as discoverLabels
    const grepTargets = execSync(
      `grep -roh --include='*.yaml' 'konveyor.io/target=[^ "'"'"']*' "${rulesetsDir}" | sed 's/konveyor.io\\/target=//' | sort -u`,
      { encoding: "utf-8" },
    )
      .trim()
      .split("\n")
      .filter(Boolean);

    const grepSources = execSync(
      `grep -roh --include='*.yaml' 'konveyor.io/source=[^ "'"'"']*' "${rulesetsDir}" | sed 's/konveyor.io\\/source=//' | sort -u`,
      { encoding: "utf-8" },
    )
      .trim()
      .split("\n")
      .filter(Boolean);

    const result = await discoverLabels(rulesetsDir);

    const discoveredTargetSet = new Set(result.targets);
    const discoveredSourceSet = new Set(result.sources);
    const grepTargetSet = new Set(grepTargets);
    const grepSourceSet = new Set(grepSources);

    // Same number of unique labels
    expect(discoveredTargetSet.size).toBe(grepTargetSet.size);
    expect(discoveredSourceSet.size).toBe(grepSourceSet.size);

    // Every grep-discovered label is present in our result
    for (const t of grepTargets) {
      expect(discoveredTargetSet.has(t)).toBe(true);
    }
    for (const s of grepSources) {
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
