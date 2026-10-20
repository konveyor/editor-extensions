import expect from "expect";
import { isOutsideWorkspace } from "../workspaceBoundary";

describe("isOutsideWorkspace", () => {
  it("flags parent-relative and absolute results", () => {
    expect(isOutsideWorkspace("..", "/")).toBe(true);
    expect(isOutsideWorkspace("../provider-settings.yaml", "/")).toBe(true);
    expect(isOutsideWorkspace("../../a/b", "/")).toBe(true);
    expect(isOutsideWorkspace("/abs/elsewhere.ts", "/")).toBe(true);
  });

  it("accepts paths inside the workspace, including names that start with dots", () => {
    expect(isOutsideWorkspace("src/A.java", "/")).toBe(false);
    expect(isOutsideWorkspace("..hidden/A.java", "/")).toBe(false);
    expect(isOutsideWorkspace(".konveyor/x", "/")).toBe(false);
    expect(isOutsideWorkspace("", "/")).toBe(false);
  });
});
