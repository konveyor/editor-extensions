import expect from "expect";
import { join, sep } from "node:path";
import { buildProjectSearchExclude, reIncludesSomething } from "../projectSearchExclude";

/**
 * Steering project discovery away from ignored trees (issue #758): the search
 * budget must not be spent on directories the user ignored, or a project they
 * want can be left beyond it and never discovered. Only over-exclusion can
 * hide a project, so the assembly is deliberately conservative.
 */
describe("reIncludesSomething", () => {
  it("spots a negation anywhere in the patterns", () => {
    expect(reIncludesSomething(["fixtures/", "!fixtures/keep/"])).toBe(true);
    expect(reIncludesSomething(["!keep"])).toBe(true);
  });

  it("is false for patterns that only ignore", () => {
    expect(reIncludesSomething([])).toBe(false);
    expect(reIncludesSomething([".konveyor", "fixtures/", "target"])).toBe(false);
  });
});

describe("buildProjectSearchExclude", () => {
  const root = join(sep, "repo");

  it("skips the given directory names at any depth", () => {
    expect(buildProjectSearchExclude(root, ["node_modules", "target"], [])).toBe(
      "{**/node_modules/**,**/target/**}",
    );
  });

  it("anchors an ignored directory to the folder it was found in", () => {
    expect(buildProjectSearchExclude(root, ["target"], [join(root, "fixtures")])).toBe(
      "{**/target/**,fixtures/**}",
    );
  });

  it("anchors a nested ignored directory by its whole path", () => {
    expect(buildProjectSearchExclude(root, ["target"], [join(root, "apps", "legacy")])).toBe(
      "{**/target/**,apps/legacy/**}",
    );
  });

  it("tolerates the trailing separator globby marks directories with", () => {
    expect(buildProjectSearchExclude(root, ["target"], [join(root, "fixtures") + sep])).toBe(
      "{**/target/**,fixtures/**}",
    );
  });

  it("drops a directory outside the folder, and the folder itself", () => {
    expect(
      buildProjectSearchExclude(root, ["target"], [join(sep, "elsewhere", "fixtures"), root]),
    ).toBe("**/target/**");
  });

  it("drops a directory a glob cannot name literally", () => {
    // Excluding `app{1}/**` would parse as a different pattern, and over-
    // excluding is the one error that loses a project.
    expect(buildProjectSearchExclude(root, ["target"], [join(root, "app{1}")])).toBe(
      "**/target/**",
    );
    expect(buildProjectSearchExclude(root, ["target"], [join(root, "a,b")])).toBe("**/target/**");
  });

  it("emits a lone pattern without the braces", () => {
    expect(buildProjectSearchExclude(root, ["target"], [])).toBe("**/target/**");
  });

  it("does not repeat a directory named twice", () => {
    expect(buildProjectSearchExclude(root, ["target", "target"], [join(root, "fixtures")])).toBe(
      "{**/target/**,fixtures/**}",
    );
  });
});
