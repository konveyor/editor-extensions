import expect from "expect";
import { buildRulesetsList } from "../rulesets";

describe("buildRulesetsList", () => {
  const baseProfile = {
    useDefaultRules: true,
    customRules: [] as string[],
  };

  it("should include core + provider rulesets when useDefaultRules is true", () => {
    const rulesets = buildRulesetsList(
      { ...baseProfile, useDefaultRules: true },
      "/core/rulesets",
      ["/java/rulesets", "/nodejs/rulesets"],
    );
    expect(rulesets).toEqual(["/core/rulesets", "/java/rulesets", "/nodejs/rulesets"]);
  });

  it("should exclude core and provider rulesets when useDefaultRules is false", () => {
    const rulesets = buildRulesetsList(
      { ...baseProfile, useDefaultRules: false, customRules: ["/custom/rules"] },
      "/core/rulesets",
      ["/java/rulesets"],
    );
    expect(rulesets).toEqual(["/custom/rules"]);
  });

  it("should skip providers with empty rulesetsPaths", () => {
    const rulesets = buildRulesetsList({ ...baseProfile }, "/core/rulesets", ["/java/rulesets"]);
    expect(rulesets).toEqual(["/core/rulesets", "/java/rulesets"]);
  });

  it("should include customRules after provider rulesets", () => {
    const rulesets = buildRulesetsList(
      { ...baseProfile, useDefaultRules: true, customRules: ["/custom/rules"] },
      "/core/rulesets",
      ["/java/rulesets"],
    );
    expect(rulesets).toEqual(["/core/rulesets", "/java/rulesets", "/custom/rules"]);
  });
});
