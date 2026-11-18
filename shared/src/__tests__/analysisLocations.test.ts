import { expect } from "expect";
import { analysisLocations, topMostDirs, MAX_ANALYSIS_LOCATIONS } from "../utils/analysisLocations";

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
  // Each folder's own project comes first, before any folder's second one,
  // so a caller's cap cannot starve a folder.
  it("keeps a folder opened inside another as its own location", () => {
    expect(analysisLocations([["/repo/independent-service"], ["/repo"]])).toEqual([
      "/repo/independent-service",
      "/repo",
    ]);
  });

  it("keeps a project found below an opened wrapper folder", () => {
    expect(analysisLocations([["/repo/wrapper/service"], ["/repo"]])).toEqual([
      "/repo/wrapper/service",
      "/repo",
    ]);
  });

  it("still collapses modules within a single folder", () => {
    expect(
      analysisLocations([
        ["/repo/wrapper/service", "/repo/wrapper/service/module-a"],
        ["/repo", "/repo/module-b"],
      ]),
    ).toEqual(["/repo/wrapper/service", "/repo"]);
  });

  it("counts a project found from two folders once", () => {
    expect(
      analysisLocations([["/repo/wrapper/service"], ["/repo/wrapper/service/", "/repo/other"]]),
    ).toEqual(["/repo/wrapper/service", "/repo/other"]);
  });

  it("tolerates folders without a project", () => {
    expect(analysisLocations([])).toEqual([]);
    expect(analysisLocations([[], ["/repo"]])).toEqual(["/repo"]);
    // Empty only when every folder is: the callers read an empty result as
    // "nothing the user wants analyzed" and emit no location for it.
    expect(analysisLocations([[], []])).toEqual([]);
  });

  it("gives every folder a turn before any folder takes a second", () => {
    expect(analysisLocations([["/a/p1", "/a/p2", "/a/p3"], ["/b/p1"], ["/c/p1", "/c/p2"]])).toEqual(
      ["/a/p1", "/b/p1", "/c/p1", "/a/p2", "/c/p2", "/a/p3"],
    );
  });

  it("orders a single folder's projects shallowest first", () => {
    expect(analysisLocations([["/repo/deep/nested/service", "/repo/service"]])).toEqual([
      "/repo/service",
      "/repo/deep/nested/service",
    ]);
  });

  it("keeps the cap from starving a folder whose only project is deep", () => {
    const deepSingle = "/repo/a/b/c/d/service";
    const monorepo = Array.from({ length: MAX_ANALYSIS_LOCATIONS + 2 }, (_, i) => `/mono/p${i}`);

    const capped = analysisLocations([[deepSingle], monorepo]).slice(0, MAX_ANALYSIS_LOCATIONS);

    expect(capped).toContain(deepSingle);
    expect(capped).toHaveLength(MAX_ANALYSIS_LOCATIONS);
  });

  it("leaves the rest of the cap to folders that still have projects", () => {
    const monorepo = Array.from({ length: MAX_ANALYSIS_LOCATIONS + 2 }, (_, i) => `/mono/p${i}`);

    const capped = analysisLocations([["/repo/service"], monorepo]).slice(
      0,
      MAX_ANALYSIS_LOCATIONS,
    );

    expect(capped.filter((dir) => dir.startsWith("/mono/"))).toHaveLength(
      MAX_ANALYSIS_LOCATIONS - 1,
    );
  });
});
