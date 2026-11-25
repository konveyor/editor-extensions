import { getIncidentDisplayPath } from "../incident";
import { getWorkspaceRelativePath, normalizeWorkspacePath } from "../workspacePath";
import { Incident } from "@editor-extensions/shared";
import { expect } from "expect";

describe("normalizeWorkspacePath", () => {
  it("strips the file:// prefix and trailing slash", () => {
    expect(normalizeWorkspacePath("file:///home/user/project/")).toBe("/home/user/project");
  });

  it("decodes escaped characters in URIs", () => {
    expect(normalizeWorkspacePath("file:///home/user/My%20Project")).toBe("/home/user/My Project");
  });

  it("normalizes Windows URIs and paths to the same form", () => {
    expect(normalizeWorkspacePath("file:///C:/Users/John/project")).toBe("C:/Users/John/project");
    expect(normalizeWorkspacePath("C:\\Users\\John\\project")).toBe("C:/Users/John/project");
  });
});

describe("getWorkspaceRelativePath", () => {
  it("returns the path relative to a single workspace folder", () => {
    expect(
      getWorkspaceRelativePath("/home/user/project/src/App.java", ["file:///home/user/project"]),
    ).toBe("src/App.java");
  });

  it("prefixes the folder name in a multi-root workspace", () => {
    const roots = ["file:///home/user/api", "file:///home/user/web"];

    expect(getWorkspaceRelativePath("/home/user/api/src/App.java", roots)).toBe("api/src/App.java");
    expect(getWorkspaceRelativePath("/home/user/web/src/index.ts", roots)).toBe("web/src/index.ts");
  });

  it("uses the innermost folder when folders are nested", () => {
    const roots = ["file:///home/user/repo", "file:///home/user/repo/service"];

    expect(getWorkspaceRelativePath("/home/user/repo/service/src/Main.java", roots)).toBe(
      "service/src/Main.java",
    );
  });

  it("does not match a folder that only shares a name prefix", () => {
    const roots = ["file:///home/user/app", "file:///home/user/app-tests"];

    expect(getWorkspaceRelativePath("/home/user/app-tests/Test.java", roots)).toBe(
      "app-tests/Test.java",
    );
  });

  it("returns undefined for a file outside every workspace folder", () => {
    expect(
      getWorkspaceRelativePath("/tmp/other/File.java", ["file:///home/user/project"]),
    ).toBeUndefined();
  });

  it("matches Windows paths regardless of drive letter case and separators", () => {
    const roots = ["file:///c:/Users/John/api", "file:///c:/Users/John/web"];

    expect(getWorkspaceRelativePath("C:\\Users\\John\\web\\src\\index.ts", roots)).toBe(
      "web/src/index.ts",
    );
  });
});

describe("getIncidentDisplayPath", () => {
  const incident = (uri: string): Incident => ({ uri, message: "Test message" });

  it("keeps the existing single-root behavior", () => {
    const it1 = incident("file:///home/user/project/src/file.ts");

    expect(
      getIncidentDisplayPath(it1, "file:///home/user/project", ["file:///home/user/project"]),
    ).toBe("/src/file.ts");
    expect(getIncidentDisplayPath(it1, "file:///home/user/project")).toBe("/src/file.ts");
  });

  it("shows incidents outside the first folder relative to their own folder", () => {
    const roots = ["file:///home/user/api", "file:///home/user/web"];

    expect(
      getIncidentDisplayPath(incident("file:///home/user/web/src/App.java"), roots[0], roots),
    ).toBe("web/src/App.java");
    expect(getIncidentDisplayPath(incident("file:///home/user/api/pom.xml"), roots[0], roots)).toBe(
      "api/pom.xml",
    );
  });
});
