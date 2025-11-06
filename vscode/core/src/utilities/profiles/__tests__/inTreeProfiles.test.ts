import expect from "expect";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { discoverInTreeProfiles } from "../inTreeProfiles";

describe("discoverInTreeProfiles", () => {
  let tempDir: string;
  let profilesDir: string;

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "konveyor-test-"));
    profilesDir = path.join(tempDir, ".konveyor", "profiles");
  });

  afterEach(async () => {
    // Clean up temporary directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should return empty array when .konveyor/profiles directory does not exist", async () => {
    const result = await discoverInTreeProfiles(tempDir);
    expect(result).toEqual([]);
  });

  it("should return empty array when .konveyor/profiles is empty", async () => {
    await fs.mkdir(profilesDir, { recursive: true });
    const result = await discoverInTreeProfiles(tempDir);
    expect(result).toEqual([]);
  });

  it("should discover and parse valid profile YAML files", async () => {
    const profileDir = path.join(profilesDir, "test-profile");
    await fs.mkdir(profileDir, { recursive: true });

    const profileYaml = `metadata:
  name: "Test Profile"
  id: "test-profile"
  source: "local"
  version: "1.0.0"
  readonly: false

spec:
  labelSelector: "konveyor.io/target=quarkus"
  customRules:
    - "./rulesets/custom-rules.yaml"
  useDefaultRules: true
`;

    await fs.writeFile(path.join(profileDir, "profile.yaml"), profileYaml);

    const result = await discoverInTreeProfiles(tempDir);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("test-profile");
    expect(result[0].name).toBe("Test Profile");
    expect(result[0].labelSelector).toBe("konveyor.io/target=quarkus");
    expect(result[0].useDefaultRules).toBe(true);
    expect(result[0].readOnly).toBe(false);
    expect(result[0].source).toBe("local");
    expect(result[0].version).toBe("1.0.0");

    // Verify custom rules paths are resolved to absolute
    expect(path.isAbsolute(result[0].customRules[0])).toBe(true);
    expect(result[0].customRules[0]).toContain("custom-rules.yaml");
  });

  it("should handle malformed YAML gracefully", async () => {
    const profileDir = path.join(profilesDir, "bad-profile");
    await fs.mkdir(profileDir, { recursive: true });

    const badYaml = "invalid: yaml: content:";
    await fs.writeFile(path.join(profileDir, "profile.yaml"), badYaml);

    const result = await discoverInTreeProfiles(tempDir);
    expect(result).toEqual([]);
  });

  it("should skip profiles with missing required fields", async () => {
    const profileDir = path.join(profilesDir, "incomplete-profile");
    await fs.mkdir(profileDir, { recursive: true });

    const incompleteYaml = `metadata:
  name: "Incomplete Profile"
  # Missing id field

spec:
  labelSelector: "konveyor.io/target=quarkus"
`;

    await fs.writeFile(path.join(profileDir, "profile.yaml"), incompleteYaml);

    const result = await discoverInTreeProfiles(tempDir);
    expect(result).toEqual([]);
  });

  it("should discover multiple profiles", async () => {
    // Create first profile
    const profile1Dir = path.join(profilesDir, "profile-1");
    await fs.mkdir(profile1Dir, { recursive: true });
    const profile1Yaml = `metadata:
  name: "Profile 1"
  id: "profile-1"
  source: "local"

spec:
  labelSelector: "konveyor.io/target=quarkus"
  useDefaultRules: true
`;
    await fs.writeFile(path.join(profile1Dir, "profile.yaml"), profile1Yaml);

    // Create second profile
    const profile2Dir = path.join(profilesDir, "profile-2");
    await fs.mkdir(profile2Dir, { recursive: true });
    const profile2Yaml = `metadata:
  name: "Profile 2"
  id: "profile-2"
  source: "local"

spec:
  labelSelector: "konveyor.io/target=eap8"
  customRules:
    - "./custom.yaml"
  useDefaultRules: false
`;
    await fs.writeFile(path.join(profile2Dir, "profile.yaml"), profile2Yaml);

    const result = await discoverInTreeProfiles(tempDir);

    expect(result).toHaveLength(2);
    const profileIds = result.map((p) => p.id).sort();
    expect(profileIds).toEqual(["profile-1", "profile-2"]);
  });

  it("should default useDefaultRules to true if not specified", async () => {
    const profileDir = path.join(profilesDir, "default-profile");
    await fs.mkdir(profileDir, { recursive: true });

    const profileYaml = `metadata:
  name: "Default Rules Profile"
  id: "default-profile"
  source: "local"

spec:
  labelSelector: "konveyor.io/target=quarkus"
`;

    await fs.writeFile(path.join(profileDir, "profile.yaml"), profileYaml);

    const result = await discoverInTreeProfiles(tempDir);

    expect(result[0].useDefaultRules).toBe(true);
  });

  it("should default readonly to false if not specified", async () => {
    const profileDir = path.join(profilesDir, "test-profile");
    await fs.mkdir(profileDir, { recursive: true });

    const profileYaml = `metadata:
  name: "Test Profile"
  id: "test-profile"
  source: "local"

spec:
  labelSelector: "konveyor.io/target=quarkus"
`;

    await fs.writeFile(path.join(profileDir, "profile.yaml"), profileYaml);

    const result = await discoverInTreeProfiles(tempDir);

    expect(result[0].readOnly).toBe(false);
  });

  it("should skip non-directory entries", async () => {
    await fs.mkdir(profilesDir, { recursive: true });

    // Create a valid profile directory
    const profileDir = path.join(profilesDir, "valid-profile");
    await fs.mkdir(profileDir);
    const profileYaml = `metadata:
  name: "Valid Profile"
  id: "valid-profile"
  source: "local"

spec:
  labelSelector: "konveyor.io/target=quarkus"
`;
    await fs.writeFile(path.join(profileDir, "profile.yaml"), profileYaml);

    // Create a file (not directory) in profiles dir - should be ignored
    await fs.writeFile(path.join(profilesDir, "not-a-profile.txt"), "some content");

    const result = await discoverInTreeProfiles(tempDir);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("valid-profile");
  });

  it("should handle empty customRules array", async () => {
    const profileDir = path.join(profilesDir, "no-custom-rules");
    await fs.mkdir(profileDir, { recursive: true });

    const profileYaml = `metadata:
  name: "No Custom Rules"
  id: "no-custom-rules"
  source: "local"

spec:
  labelSelector: "konveyor.io/target=quarkus"
  customRules: []
  useDefaultRules: true
`;

    await fs.writeFile(path.join(profileDir, "profile.yaml"), profileYaml);

    const result = await discoverInTreeProfiles(tempDir);

    expect(result[0].customRules).toEqual([]);
  });
});
