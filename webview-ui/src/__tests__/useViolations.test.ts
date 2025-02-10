import { renderHook } from "@testing-library/react";
import { expect } from "expect";
import { useViolations } from "../hooks/useViolations";
import { RuleSet } from "@editor-extensions/shared";

describe("useViolations hook", () => {
  it("undefined input = empty array", () => {
    const { result } = renderHook(() => useViolations(undefined));
    expect(result.current).toHaveLength(0);
  });

  it("empty array = empty array", () => {
    const { result } = renderHook(() => useViolations([]));
    expect(result.current).toHaveLength(0);
  });

  it("ruleset without violations = empty array", () => {
    const ruleSets: RuleSet[] = [
      {
        name: "test",
        description: "test",
        violations: undefined,
      },
    ];

    const { result } = renderHook(() => useViolations(ruleSets));
    expect(result.current).toHaveLength(0);
  });

  it("ruleset with violations = array of violations", () => {
    const ruleSets: RuleSet[] = [
      {
        name: "test1",
        description: "test1",
        violations: {
          v1: {
            id: "violation1",
            description: "v1 description",
            incidents: [
              {
                uri: "file://v1i1.txt",
                message: "incident 1",
              },
              {
                uri: "file://v1i2.txt",
                message: "incident 2",
              },
            ],
          },
        },
      },
      {
        name: "test2",
        description: "test2",
        violations: {
          v2: {
            id: "violation2",
            description: "v2 description",
            incidents: [
              {
                uri: "file://v2i3.txt",
                message: "incident 3",
              },
              {
                uri: "file://v2i4.txt",
                message: "incident 4",
              },
            ],
          },
        },
      },
    ];

    const { result } = renderHook(() => useViolations(ruleSets));
    expect(result.current).toEqual([
      {
        id: "violation1",
        description: "v1 description",
        rulesetName: "test1",
        violationName: "v1",
        incidents: [
          { message: "incident 1", uri: "file://v1i1.txt" },
          { message: "incident 2", uri: "file://v1i2.txt" },
        ],
      },
      {
        id: "violation2",
        description: "v2 description",
        rulesetName: "test2",
        violationName: "v2",
        incidents: [
          { message: "incident 3", uri: "file://v2i3.txt" },
          { message: "incident 4", uri: "file://v2i4.txt" },
        ],
      },
    ]);
  });
});
