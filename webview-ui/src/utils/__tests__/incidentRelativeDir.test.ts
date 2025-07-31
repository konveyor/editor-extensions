import { getIncidentRelativeDir } from "../incident";
import { Incident } from "@editor-extensions/shared";
import { expect } from "expect";

describe("getIncidentRelativeDir", () => {
  // Base incident to modify in each test
  const baseIncident: Incident = {
    uri: "",
    message: "Test message",
  };

  it("correctly computes relative path (POSIX)", () => {
    const incident = { ...baseIncident, uri: "file:///home/user/project/src/file.ts" };
    const workspaceRoot = "file:///home/user/project";

    expect(getIncidentRelativeDir(incident, workspaceRoot)).toBe("src");
  });

  it("correctly computes relative path (Windows)", () => {
    const incident = { ...baseIncident, uri: "file:///C:/Users/John/project/src/file.ts" };
    const workspaceRoot = "file:///C:/Users/John/project";

    expect(getIncidentRelativeDir(incident, workspaceRoot)).toBe("src");
  });

  it("handles Windows paths with backslashes", () => {
    const incident = { ...baseIncident, uri: "file:///C:\\Users\\John\\project\\src\\file.ts" };
    const workspaceRoot = "file:///C:/Users/John/project";

    expect(getIncidentRelativeDir(incident, workspaceRoot)).toBe("src");
  });

  it("handles Windows paths with lower case drive name in incident", () => {
    const incident = { ...baseIncident, uri: "file:///c:\\Users\\John\\project\\src\\file.ts" };
    const workspaceRoot = "file:///C:/Users/John/project";

    expect(getIncidentRelativeDir(incident, workspaceRoot)).toBe("src");
  });

  it("handles Windows paths with lower case drive name workspace root", () => {
    const incident = { ...baseIncident, uri: "file:///C:\\Users\\John\\project\\src\\file.ts" };
    const workspaceRoot = "file:///c:/Users/John/project";

    expect(getIncidentRelativeDir(incident, workspaceRoot)).toBe("src");
  });

  it("correctly computes relative path for root file (pom.xml)", () => {
    const incident = { ...baseIncident, uri: "file:///home/user/project/pom.xml" };
    const workspaceRoot = "file:///home/user/project";

    expect(getIncidentRelativeDir(incident, workspaceRoot)).toBe(""); // Should return empty string
  });

  it("correctly computes relative path for root file (Windows pom.xml)", () => {
    const incident = { ...baseIncident, uri: "file:///C:/Users/John/project/pom.xml" };
    const workspaceRoot = "file:///C:/Users/John/project";

    expect(getIncidentRelativeDir(incident, workspaceRoot)).toBe(""); // Should return empty string
  });

  it("handles workspace root with trailing slash", () => {
    const incident = { ...baseIncident, uri: "file:///home/user/project/src/file.ts" };
    const workspaceRoot = "file:///home/user/project/";

    expect(getIncidentRelativeDir(incident, workspaceRoot)).toBe("src");
  });

  it("handles workspace root without trailing slash", () => {
    const incident = { ...baseIncident, uri: "file:///home/user/project/src/file.ts" };
    const workspaceRoot = "file:///home/user/project";

    expect(getIncidentRelativeDir(incident, workspaceRoot)).toBe("src");
  });

  it("handles Windows workspace root with trailing slash", () => {
    const incident = { ...baseIncident, uri: "file:///C:/Users/John/project/src/file.ts" };
    const workspaceRoot = "file:///C:/Users/John/project/";

    expect(getIncidentRelativeDir(incident, workspaceRoot)).toBe("src");
  });

  it("handles Windows workspace root without trailing slash", () => {
    const incident = { ...baseIncident, uri: "file:///C:/Users/John/project/src/file.ts" };
    const workspaceRoot = "file:///C:/Users/John/project";

    expect(getIncidentRelativeDir(incident, workspaceRoot)).toBe("src");
  });

  it("handles Windows root file with trailing slash in workspace root", () => {
    const incident = { ...baseIncident, uri: "file:///C:/Users/John/project/pom.xml" };
    const workspaceRoot = "file:///C:/Users/John/project/";

    expect(getIncidentRelativeDir(incident, workspaceRoot)).toBe(""); // Should return empty string
  });
});
