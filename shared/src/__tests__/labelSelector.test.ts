import { buildLabelSelector } from "../labelSelector";
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
