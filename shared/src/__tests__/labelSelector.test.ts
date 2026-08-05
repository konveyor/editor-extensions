import { buildLabelSelector, buildLabelSelectorFromLabels } from "../labelSelector";
import { expect } from "expect";

describe("buildLabelSelector", () => {
  it("should return discovery when no sources or targets are provided", () => {
    const result = buildLabelSelector([], []);
    expect(result).toBe("(discovery)");
  });

  it("should return targets OR discovery when only targets are provided", () => {
    const result = buildLabelSelector([], ["spring-boot", "quarkus"]);
    expect(result).toBe(
      "(konveyor.io/target=spring-boot || konveyor.io/target=quarkus) || (discovery)",
    );
  });

  it("should return sources OR discovery when only sources are provided", () => {
    const result = buildLabelSelector(["java-ee", "weblogic"], []);
    expect(result).toBe(
      "(konveyor.io/source=java-ee || konveyor.io/source=weblogic) || (discovery)",
    );
  });

  it("should return targets AND sources OR discovery when both are provided", () => {
    const result = buildLabelSelector(["java-ee"], ["spring-boot"]);
    expect(result).toBe(
      "(konveyor.io/target=spring-boot) && (konveyor.io/source=java-ee) || (discovery)",
    );
  });

  it("should handle multiple sources and targets", () => {
    const result = buildLabelSelector(["java-ee", "weblogic"], ["spring-boot", "quarkus"]);
    expect(result).toBe(
      "(konveyor.io/target=spring-boot || konveyor.io/target=quarkus) && (konveyor.io/source=java-ee || konveyor.io/source=weblogic) || (discovery)",
    );
  });

  it("should handle single source and target", () => {
    const result = buildLabelSelector(["java-ee"], ["spring-boot"]);
    expect(result).toBe(
      "(konveyor.io/target=spring-boot) && (konveyor.io/source=java-ee) || (discovery)",
    );
  });

  it("should handle special characters in technology names", () => {
    const result = buildLabelSelector(["java-ee-8"], ["spring-boot-3.0"]);
    expect(result).toBe(
      "(konveyor.io/target=spring-boot-3.0) && (konveyor.io/source=java-ee-8) || (discovery)",
    );
  });

  it("should handle empty strings in arrays", () => {
    const result = buildLabelSelector([""], [""]);
    expect(result).toBe("(konveyor.io/target=) && (konveyor.io/source=) || (discovery)");
  });

  it("should handle arrays with mixed empty and non-empty strings", () => {
    const result = buildLabelSelector(["java-ee", ""], ["spring-boot"]);
    expect(result).toBe(
      "(konveyor.io/target=spring-boot) && (konveyor.io/source=java-ee || konveyor.io/source=) || (discovery)",
    );
  });

  it("should handle technology names with dots", () => {
    const result = buildLabelSelector(["java-ee-7.0"], ["spring-boot-2.7"]);
    expect(result).toBe(
      "(konveyor.io/target=spring-boot-2.7) && (konveyor.io/source=java-ee-7.0) || (discovery)",
    );
  });

  it("should handle technology names with underscores", () => {
    const result = buildLabelSelector(["java_ee"], ["spring_boot"]);
    expect(result).toBe(
      "(konveyor.io/target=spring_boot) && (konveyor.io/source=java_ee) || (discovery)",
    );
  });

  it("should handle large arrays", () => {
    const sources = Array.from({ length: 5 }, (_, i) => `source-${i}`);
    const targets = Array.from({ length: 5 }, (_, i) => `target-${i}`);
    const result = buildLabelSelector(sources, targets);

    const expectedSources = sources.map((s) => `konveyor.io/source=${s}`).join(" || ");
    const expectedTargets = targets.map((t) => `konveyor.io/target=${t}`).join(" || ");
    const expected = `(${expectedTargets}) && (${expectedSources}) || (discovery)`;

    expect(result).toBe(expected);
  });

  it("should handle edge case with single element arrays", () => {
    const result = buildLabelSelector(["single-source"], ["single-target"]);
    expect(result).toBe(
      "(konveyor.io/target=single-target) && (konveyor.io/source=single-source) || (discovery)",
    );
  });

  it("should handle real-world migration scenarios", () => {
    // EAP 6 to EAP 7 migration
    const eapResult = buildLabelSelector(["eap6"], ["eap7"]);
    expect(eapResult).toBe("(konveyor.io/target=eap7) && (konveyor.io/source=eap6) || (discovery)");

    // WebLogic to Spring Boot migration
    const weblogicResult = buildLabelSelector(["weblogic"], ["spring-boot"]);
    expect(weblogicResult).toBe(
      "(konveyor.io/target=spring-boot) && (konveyor.io/source=weblogic) || (discovery)",
    );

    // Multiple source platforms to cloud native
    const cloudResult = buildLabelSelector(["weblogic", "websphere"], ["kubernetes", "openshift"]);
    expect(cloudResult).toBe(
      "(konveyor.io/target=kubernetes || konveyor.io/target=openshift) && (konveyor.io/source=weblogic || konveyor.io/source=websphere) || (discovery)",
    );
  });
});

// These cases mirror RuleSelector.String() in tackle2-addon-analyzer
// (cmd/rules.go). The IDE must produce byte-identical selectors to the Hub for
// the same profile, otherwise a synced profile yields different issues in each.
describe("buildLabelSelectorFromLabels", () => {
  it("should return an empty selector when no labels are provided", () => {
    const result = buildLabelSelectorFromLabels([], []);
    expect(result).toBe("");
  });

  it("should not parenthesize a lone source", () => {
    const result = buildLabelSelectorFromLabels(["konveyor.io/source=java-ee"], []);
    expect(result).toBe("konveyor.io/source=java-ee");
  });

  it("should not parenthesize a lone target", () => {
    const result = buildLabelSelectorFromLabels(["konveyor.io/target=spring-boot"], []);
    expect(result).toBe("konveyor.io/target=spring-boot");
  });

  it("should AND sources with targets rather than OR them", () => {
    const result = buildLabelSelectorFromLabels(
      ["konveyor.io/source=java-ee", "konveyor.io/target=spring-boot"],
      [],
    );
    expect(result).toBe("(konveyor.io/source=java-ee&&konveyor.io/target=spring-boot)");
  });

  it("should OR within each of sources and targets, and AND across them", () => {
    const result = buildLabelSelectorFromLabels(
      [
        "konveyor.io/source=weblogic",
        "konveyor.io/source=websphere",
        "konveyor.io/target=eap8",
        "konveyor.io/target=cloud-readiness",
      ],
      [],
    );
    expect(result).toBe(
      "((konveyor.io/source=weblogic||konveyor.io/source=websphere)&&" +
        "(konveyor.io/target=cloud-readiness||konveyor.io/target=eap8))",
    );
  });

  it("should negate a single excluded label", () => {
    const result = buildLabelSelectorFromLabels(
      ["konveyor.io/source=java-ee", "konveyor.io/target=spring-boot"],
      ["konveyor.io/target=eap7"],
    );
    expect(result).toBe(
      "((konveyor.io/source=java-ee&&konveyor.io/target=spring-boot)&&!konveyor.io/target=eap7)",
    );
  });

  it("should negate multiple excluded labels as a group", () => {
    const result = buildLabelSelectorFromLabels(
      ["konveyor.io/source=java-ee"],
      ["konveyor.io/target=eap7", "konveyor.io/target=eap6"],
    );
    expect(result).toBe(
      "(konveyor.io/source=java-ee&&!(konveyor.io/target=eap6||konveyor.io/target=eap7))",
    );
  });

  // The Hub builds rules.labels.included by ranging over a Go map, so the order
  // it hands us changes between bundle downloads. The selector we derive has to
  // be stable, otherwise every sync rewrites profile.yaml in the workspace.
  it("should produce the same selector regardless of the order labels arrive in", () => {
    const labels = [
      "konveyor.io/target=cloud-readiness",
      "konveyor.io/source=websphere",
      "konveyor.io/target=openliberty",
      "konveyor.io/source=javaee",
    ];
    const shuffled = [
      "konveyor.io/source=websphere",
      "konveyor.io/target=openliberty",
      "konveyor.io/source=javaee",
      "konveyor.io/target=cloud-readiness",
    ];

    expect(buildLabelSelectorFromLabels(shuffled, [])).toBe(
      buildLabelSelectorFromLabels(labels, []),
    );
  });

  it("should OR non-konveyor.io labels with the source/target clause", () => {
    const result = buildLabelSelectorFromLabels(
      ["other.namespace/label=value", "konveyor.io/source=java-ee"],
      [],
    );
    expect(result).toBe("(other.namespace/label=value||konveyor.io/source=java-ee)");
  });

  it("should treat konveyor.io labels that are neither source nor target as other", () => {
    const result = buildLabelSelectorFromLabels(
      ["konveyor.io/other=value", "konveyor.io/source=java-ee"],
      [],
    );
    expect(result).toBe("(konveyor.io/other=value||konveyor.io/source=java-ee)");
  });

  it("should de-duplicate included and excluded labels", () => {
    const result = buildLabelSelectorFromLabels(
      ["konveyor.io/source=java-ee", "konveyor.io/source=java-ee"],
      ["konveyor.io/target=eap7", "konveyor.io/target=eap7"],
    );
    expect(result).toBe("(konveyor.io/source=java-ee&&!konveyor.io/target=eap7)");
  });

  // Captured from a live Hub: profile with targets Containerization + Open
  // Liberty and additional source labels javaee + websphere. The Hub's analyzer
  // addon logged exactly this selector; the extension must match it.
  it("should reproduce the selector a live Hub used for a websphere->openliberty profile", () => {
    const result = buildLabelSelectorFromLabels(
      [
        "konveyor.io/source=javaee",
        "konveyor.io/source=websphere",
        "konveyor.io/target=cloud-readiness",
        "konveyor.io/target=openliberty",
      ],
      [],
    );
    expect(result).toBe(
      "((konveyor.io/source=javaee||konveyor.io/source=websphere)&&" +
        "(konveyor.io/target=cloud-readiness||konveyor.io/target=openliberty))",
    );
  });
});
