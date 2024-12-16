import { RuleSet } from "@editor-extensions/shared";
import { produce } from "immer";
import { mergeRuleSetsWithStringPaths as mergeRuleSets } from "../mergeRuleSets";
import expect from "expect";
import { FOO, BAR, DISCOVERY } from "./data";

const BASE_STATE: RuleSet[] = [FOO, BAR, DISCOVERY];

const PARTIAL_NO_INCIDENTS: RuleSet[] = [
  produce(FOO, (draft: RuleSet) => {
    draft.violations!["foo-01"].incidents = [];
  }),
  produce(BAR, (draft: RuleSet) => {
    draft.violations!["bar-01"].incidents = [];
    draft.violations!["bar-02"].incidents = [];
  }),
  produce(DISCOVERY, (draft: RuleSet) => {
    draft.insights!["discover-java-files"].incidents.pop();
  }),
];

const PARTIAL_SINGLE_INCIDENT: RuleSet[] = [
  produce(FOO, (draft: RuleSet) => {
    draft.violations!["foo-01"].incidents = [
      {
        uri: "file:///src/Foo.java",
        message: "new message",
        codeSnip: "Foo",
        lineNumber: 57,
      },
    ];
  }),
];

const EMPTY_PARTIAL: RuleSet[] = [];
const SAVED_FILES: string[] = ["file:///src/Foo.java", "file:///src/Bar.java"];

describe("mergeRuleSets() removes old violations/incidents in the chosen files", () => {
  it("handles empty response", () => {
    const merged: RuleSet[] = produce(BASE_STATE, (draft) =>
      mergeRuleSets(draft, EMPTY_PARTIAL, SAVED_FILES),
    );
    expect(merged).toHaveLength(3);
    const [foo, bar, discovery] = merged;

    expect(foo.violations?.["foo-01"].incidents).toHaveLength(0);
    expect(bar.violations?.["bar-01"].incidents).toHaveLength(1);
    expect(bar.violations?.["bar-02"].incidents).toHaveLength(1);
    expect(discovery.insights?.["discover-java-files"].incidents).toHaveLength(3);
  });
  it("handles response with no incidents", () => {
    const merged: RuleSet[] = produce(BASE_STATE, (draft) =>
      mergeRuleSets(draft, PARTIAL_NO_INCIDENTS, SAVED_FILES),
    );
    expect(merged).toHaveLength(3);
    const [foo, bar, discovery] = merged;

    expect(foo.violations?.["foo-01"].incidents).toHaveLength(0);
    expect(bar.violations?.["bar-01"].incidents).toHaveLength(1);
    expect(bar.violations?.["bar-02"].incidents).toHaveLength(1);
    expect(discovery.insights?.["discover-java-files"].incidents).toHaveLength(3);
  });
});

describe("mergeRuleSets() adds new violations/incidents in the chosen files", () => {
  it("adds an incident", () => {
    const merged: RuleSet[] = produce(BASE_STATE, (draft) =>
      mergeRuleSets(draft, PARTIAL_SINGLE_INCIDENT, SAVED_FILES),
    );
    expect(merged).toHaveLength(3);
    const [foo] = merged;

    expect(foo.violations?.["foo-01"].incidents).toHaveLength(1);
    expect(foo.violations?.["foo-01"].incidents[0].message).toBe("new message");
  });
});

describe("mergeRuleSets() workarounds", () => {
  it("ignores files outside of included_paths received in analysis response", () => {
    const responseWithUnknownFile = produce(FOO, (draft: RuleSet) => {
      draft.violations!["foo-01"].incidents = [
        {
          uri: "file:///src/UnknownFile.java",
          message: "new message",
        },
      ];
    });
    const merged: RuleSet[] = produce(BASE_STATE, (draft) =>
      mergeRuleSets(draft, [responseWithUnknownFile], SAVED_FILES),
    );
    expect(merged).toHaveLength(3);
    const [foo] = merged;

    expect(foo.violations?.["foo-01"].incidents).toHaveLength(0);
  });
  it("takes the whole partial response if there is no base response in the state", () => {
    const merged: RuleSet[] = produce([] as RuleSet[], (draft) =>
      mergeRuleSets(draft, PARTIAL_SINGLE_INCIDENT, SAVED_FILES),
    );
    expect(merged).toHaveLength(1);
    const [foo] = merged;

    expect(foo.violations?.["foo-01"].incidents).toHaveLength(1);
    expect(foo.violations?.["foo-01"].incidents[0].message).toBe("new message");
  });
});
