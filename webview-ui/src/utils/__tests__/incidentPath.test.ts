import { getIncidentFile } from "../incident";
import { Incident } from "@editor-extensions/shared";
import { expect } from "expect";

describe("getIncidentFile", () => {
  // Base incident to modify in each test
  const baseIncident: Incident = {
    uri: "",
    message: "Test message",
  };

  it("correctly extracts file name (POSIX)", () => {
    const incident = { ...baseIncident, uri: "file:///home/user/project/src/file.ts" };
    expect(getIncidentFile(incident)).toBe("file.ts");
  });

  it("correctly extracts file name (Windows)", () => {
    const incident = { ...baseIncident, uri: "file:///C:/Users/John/project/src/file.ts" };
    expect(getIncidentFile(incident)).toBe("file.ts");
  });

  it("handles Windows paths with backslashes", () => {
    const incident = { ...baseIncident, uri: "file:///C:\\Users\\John\\project\\src\\file.ts" };
    expect(getIncidentFile(incident)).toBe("file.ts");
  });

  it("handles file in root directory (POSIX)", () => {
    const incident = { ...baseIncident, uri: "file:///home/user/project/rootfile.txt" };
    expect(getIncidentFile(incident)).toBe("rootfile.txt");
  });

  it("handles file in root directory (Windows)", () => {
    const incident = { ...baseIncident, uri: "file:///C:/Users/John/rootfile.txt" };
    expect(getIncidentFile(incident)).toBe("rootfile.txt");
  });

  it("handles file with special characters", () => {
    const incident = { ...baseIncident, uri: "file:///home/user/project/some file (1).txt" };
    expect(getIncidentFile(incident)).toBe("some file (1).txt");
  });

  it("handles Windows UNC paths", () => {
    const incident = { ...baseIncident, uri: "file://server/share/folder/file.txt" };
    expect(getIncidentFile(incident)).toBe("file.txt");
  });

  it("handles file with no extension", () => {
    const incident = { ...baseIncident, uri: "file:///home/user/project/README" };
    expect(getIncidentFile(incident)).toBe("README");
  });

  it("handles deeply nested paths", () => {
    const incident = { ...baseIncident, uri: "file:///home/user/project/a/b/c/d/file.log" };
    expect(getIncidentFile(incident)).toBe("file.log");
  });
});
