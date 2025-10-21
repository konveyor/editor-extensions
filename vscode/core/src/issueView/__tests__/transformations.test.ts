import { Incident, RuleSet } from "@editor-extensions/shared";
import { produce } from "immer";
import { FOO } from "../../analysis/__tests__/data";
import { allIncidents } from "../transformation";
import expect from "expect";

describe("analysis data transformations", () => {
  it("uses first line if line number is missing or incorrect in the incident", () => {
    const responseWithoutLineNumber = [
      produce(FOO, (draft: RuleSet) => {
        draft.violations!["foo-01"].incidents = [
          {
            uri: "file:///src/Foo.java",
            message: "new message",
          },
          {
            uri: "file:///src/Foo.java",
            message: "new message",
            lineNumber: -1,
          },
          {
            uri: "file:///src/Foo.java",
            message: "new message",
            lineNumber: 0.3,
          },
          {
            uri: "file:///src/Foo.java",
            message: "new message",
            lineNumber: "foo",
          } as unknown as Incident,
        ];
      }),
    ];

    const result = allIncidents(responseWithoutLineNumber);
    expect(result).toHaveLength(4);
    result.forEach((res) => expect(res.lineNumber).toBe(1));
  });
  it("filters out incidents without message", () => {
    const response = [
      produce(FOO, (draft: RuleSet) => {
        draft.violations!["foo-01"].incidents = [
          {
            uri: "file:///src/Foo.java",
            //no message
          } as Incident,
          {
            uri: "file:///src/Foo.java",
            message: "",
          },
        ];
      }),
    ];

    expect(allIncidents(response)).toHaveLength(1);
  });
  it("filters out incidents with incorrect URI", () => {
    const response = [
      produce(FOO, (draft: RuleSet) => {
        draft.violations!["foo-01"].incidents = [
          {
            uri: "/src/Foo.java",
            message: "",
          },
          {
            uri: "",
            message: "",
          },
          {
            message: "",
          } as Incident,
        ];
      }),
    ];

    expect(allIncidents(response)).toHaveLength(0);
  });
});
