import { RuleSet } from "@editor-extensions/shared";
export const FOO: RuleSet = {
  name: "test/foo",
  description: "foo top description",
  violations: {
    "foo-01": {
      description: "foo-01 description",
      category: "mandatory",
      labels: ["konveyor.io/target=foo", "konveyor.io/target=bar"],
      incidents: [
        {
          uri: "file:///src/Foo.java",
          message: "foo-01 message",
          codeSnip: "Foo",
          lineNumber: 57,
        },
        {
          uri: "file:///src/Bar.java",
          message: "foo-01 message",
          codeSnip: "Bar",
          lineNumber: 60,
        },
      ],
      effort: 1,
    },
  },
  errors: {
    "foo-02": "unable to ask for Konveyor rule entry",
    "foo-03": "could not run grep with provided pattern exit status 2",
  },
  unmatched: ["foo-04", "foo-05"],
  skipped: ["foo-06", "foo-07"],
};
export const BAR: RuleSet = {
  name: "test/bar",
  description: "bar top description",
  violations: {
    "bar-01": {
      description: "bar-01 description",
      category: "mandatory",
      labels: ["konveyor.io/target=foo", "konveyor.io/target=bar"],
      incidents: [
        {
          uri: "file:///src/Foo.java",
          message: "bar-01 message A",
          codeSnip: "Foo",
          lineNumber: 57,
        },
        {
          uri: "file:///FooBar.java",
          message: "bar-01 message B",
          codeSnip: "FooBar",
          lineNumber: 60,
        },
      ],
      effort: 1,
    },
    "bar-02": {
      description: "bar-02 description",
      category: "mandatory",
      labels: ["konveyor.io/target=foo", "konveyor.io/target=bar"],
      incidents: [
        {
          uri: "file:///src/Bar.java",
          message: "bar-02 message A",
          codeSnip: "Bar",
          lineNumber: 57,
        },
        {
          uri: "file:///FooBar.java",
          message: "bar-02 message B",
          codeSnip: "FooBar",
          lineNumber: 60,
        },
      ],
      effort: 1,
    },
  },
  errors: {},
  unmatched: [],
  skipped: [],
};
export const DISCOVERY: RuleSet = {
  name: "discovery",
  tags: ["Java Source"],
  insights: {
    "discover-java-files": {
      description: "Java source files",
      labels: [
        "konveyor.io/include=always",
        "konveyor.io/target=discovery",
        "discovery",
        "tag=Java Source",
      ],
      incidents: [
        {
          uri: "file:///src/Foo.java",
          message: "",
        },
        {
          uri: "file:///src/Bar.java",
          message: "",
        },
        {
          uri: "file:///src/FooBar.java",
          message: "",
        },
      ],
    },
  },
};
