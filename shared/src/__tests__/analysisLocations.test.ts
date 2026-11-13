import { expect } from "expect";
import { topMostDirs } from "../utils/analysisLocations";

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

  it("keeps a nested directory that was opened as its own workspace folder", () => {
    expect(
      topMostDirs(["/repo/independent-service", "/repo"], ["/repo/independent-service", "/repo"]),
    ).toEqual(["/repo", "/repo/independent-service"]);
  });

  it("still collapses modules below a kept directory, and ignores kept entries that hold no project", () => {
    expect(
      topMostDirs(
        ["/repo", "/repo/module-a", "/repo/service", "/repo/service/module-b"],
        ["/repo/service/", "/repo/docs"],
      ),
    ).toEqual(["/repo", "/repo/service"]);
  });

  it("does not duplicate a kept directory found from two workspace folders", () => {
    expect(topMostDirs(["/repo/service", "/repo/service"], ["/repo/service"])).toEqual([
      "/repo/service",
    ]);
  });

  it("ignores empty entries and tolerates an empty list", () => {
    expect(topMostDirs([])).toEqual([]);
    expect(topMostDirs(["", "/repo"])).toEqual(["/repo"]);
  });
});
