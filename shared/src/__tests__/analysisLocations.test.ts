import { expect } from "expect";
import { analysisLocations, topMostDirs } from "../utils/analysisLocations";

describe("topMostDirs", () => {
  it("collapses module directories into the project root", () => {
    expect(
      topMostDirs(["/repo", "/repo/module-a", "/repo/module-b", "/repo/module-a/nested"]),
    ).toEqual(["/repo"]);
  });

  it("keeps sibling projects that share no root", () => {
    expect(topMostDirs(["/repo/apps/service", "/repo/apps/web"])).toEqual([
      "/repo/apps/service",
      "/repo/apps/web",
    ]);
  });

  it("does not treat a name prefix as containment", () => {
    expect(topMostDirs(["/repo/app", "/repo/apple"])).toEqual(["/repo/app", "/repo/apple"]);
  });

  it("drops duplicates, including ones differing only by a trailing separator", () => {
    expect(topMostDirs(["/repo/a", "/repo/a/", "/repo/a"])).toEqual(["/repo/a"]);
  });

  it("returns the shallowest directory first", () => {
    expect(topMostDirs(["/repo/deep/nested/project", "/other"])).toEqual([
      "/other",
      "/repo/deep/nested/project",
    ]);
  });

  it("handles windows paths and mixed separators", () => {
    expect(topMostDirs(["C:\\repo", "C:\\repo\\module"])).toEqual(["C:\\repo"]);
    expect(topMostDirs(["C:\\repo\\a", "C:/repo/a"])).toEqual(["C:\\repo\\a"]);
  });

  it("ignores empty entries and tolerates an empty list", () => {
    expect(topMostDirs([])).toEqual([]);
    expect(topMostDirs(["", "/repo"])).toEqual(["/repo"]);
  });
});

describe("analysisLocations", () => {
  it("keeps a folder opened inside another as its own location", () => {
    expect(analysisLocations([["/repo/independent-service"], ["/repo"]])).toEqual([
      "/repo",
      "/repo/independent-service",
    ]);
  });

  it("keeps a project found below an opened wrapper folder", () => {
    expect(analysisLocations([["/repo/wrapper/service"], ["/repo"]])).toEqual([
      "/repo",
      "/repo/wrapper/service",
    ]);
  });

  it("still collapses modules within a single folder", () => {
    expect(
      analysisLocations([
        ["/repo/wrapper/service", "/repo/wrapper/service/module-a"],
        ["/repo", "/repo/module-b"],
      ]),
    ).toEqual(["/repo", "/repo/wrapper/service"]);
  });

  it("counts a project found from two folders once", () => {
    expect(
      analysisLocations([["/repo/wrapper/service"], ["/repo/wrapper/service/", "/repo/other"]]),
    ).toEqual(["/repo/other", "/repo/wrapper/service"]);
  });

  it("tolerates folders without a project", () => {
    expect(analysisLocations([])).toEqual([]);
    expect(analysisLocations([[], ["/repo"]])).toEqual(["/repo"]);
  });
});
