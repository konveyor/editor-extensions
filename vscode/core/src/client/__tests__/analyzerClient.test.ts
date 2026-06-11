import expect from "expect";

// Test the getActiveProfileConfig logic in isolation.
// AnalyzerClient has heavy dependencies (vscode, ChildProcess, etc.),
// so we reproduce the exact aggregation logic in a testable wrapper.
class TestableAnalyzerClient {
  private assetPaths: { rulesets: string };
  private providerRegistry: { getProviders: () => Array<{ rulesetsPaths: string[] }> };
  private extStateData: { activeProfileId: string; profiles: any[] };

  constructor(opts: {
    rulesetsPath: string;
    providers: Array<{ rulesetsPaths: string[] }>;
    activeProfileId: string;
    profiles: any[];
  }) {
    this.assetPaths = { rulesets: opts.rulesetsPath };
    this.providerRegistry = { getProviders: () => opts.providers };
    this.extStateData = {
      activeProfileId: opts.activeProfileId,
      profiles: opts.profiles,
    };
  }

  getActiveProfileConfig() {
    const { activeProfileId, profiles } = this.extStateData;
    const profile = profiles.find((p: any) => p.id === activeProfileId);
    if (!profile) {
      throw new Error("No active profile configured.");
    }

    const providerRulesets = profile.useDefaultRules
      ? this.providerRegistry.getProviders().flatMap((p) => p.rulesetsPaths)
      : [];

    const rulesets: string[] = [
      profile.useDefaultRules ? this.assetPaths.rulesets : null,
      ...providerRulesets,
      ...(profile.customRules || []),
    ].filter(Boolean) as string[];

    return {
      labelSelector: profile.labelSelector,
      rulesets,
      isValid: !!profile.labelSelector && rulesets.length > 0,
    };
  }
}

describe("getActiveProfileConfig with provider rulesets", () => {
  const baseProfile = {
    id: "test-profile",
    name: "Test",
    labelSelector: "(konveyor.io/target=quarkus)",
    useDefaultRules: true,
    customRules: [],
  };

  it("should include core + provider rulesets when useDefaultRules is true", () => {
    const client = new TestableAnalyzerClient({
      rulesetsPath: "/core/rulesets",
      providers: [{ rulesetsPaths: ["/java/rulesets"] }, { rulesetsPaths: ["/nodejs/rulesets"] }],
      activeProfileId: "test-profile",
      profiles: [{ ...baseProfile, useDefaultRules: true }],
    });

    const config = client.getActiveProfileConfig();
    expect(config.rulesets).toEqual(["/core/rulesets", "/java/rulesets", "/nodejs/rulesets"]);
    expect(config.isValid).toBe(true);
  });

  it("should exclude core and provider rulesets when useDefaultRules is false", () => {
    const client = new TestableAnalyzerClient({
      rulesetsPath: "/core/rulesets",
      providers: [{ rulesetsPaths: ["/java/rulesets"] }],
      activeProfileId: "test-profile",
      profiles: [
        {
          ...baseProfile,
          useDefaultRules: false,
          customRules: ["/custom/rules"],
        },
      ],
    });

    const config = client.getActiveProfileConfig();
    expect(config.rulesets).toEqual(["/custom/rules"]);
  });

  it("should skip providers with empty rulesetsPaths", () => {
    const client = new TestableAnalyzerClient({
      rulesetsPath: "/core/rulesets",
      providers: [{ rulesetsPaths: [] }, { rulesetsPaths: ["/java/rulesets"] }],
      activeProfileId: "test-profile",
      profiles: [{ ...baseProfile }],
    });

    const config = client.getActiveProfileConfig();
    expect(config.rulesets).toEqual(["/core/rulesets", "/java/rulesets"]);
  });

  it("should include customRules after provider rulesets", () => {
    const client = new TestableAnalyzerClient({
      rulesetsPath: "/core/rulesets",
      providers: [{ rulesetsPaths: ["/java/rulesets"] }],
      activeProfileId: "test-profile",
      profiles: [
        {
          ...baseProfile,
          useDefaultRules: true,
          customRules: ["/custom/rules"],
        },
      ],
    });

    const config = client.getActiveProfileConfig();
    expect(config.rulesets).toEqual(["/core/rulesets", "/java/rulesets", "/custom/rules"]);
  });

  it("should throw when no active profile is found", () => {
    const client = new TestableAnalyzerClient({
      rulesetsPath: "/core/rulesets",
      providers: [],
      activeProfileId: "nonexistent",
      profiles: [],
    });

    expect(() => client.getActiveProfileConfig()).toThrow("No active profile configured.");
  });
});
