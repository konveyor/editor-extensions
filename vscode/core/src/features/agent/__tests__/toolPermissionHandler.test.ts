import expect from "expect";
import {
  isReadOnlyToolCall,
  isAcceptOption,
  findAllowOnceOptionId,
  filterPermissionOptions,
} from "../toolPermissionPolicy";
import type { PermissionOption } from "../../../client/agentBackendClient";

// --- isReadOnlyToolCall ---

describe("isReadOnlyToolCall", () => {
  it("returns true for 'view' command", () => {
    expect(isReadOnlyToolCall({ command: "view" })).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isReadOnlyToolCall({ command: "VIEW" })).toBe(true);
  });

  it("returns false for write commands", () => {
    expect(isReadOnlyToolCall({ command: "str_replace" })).toBe(false);
    expect(isReadOnlyToolCall({ command: "write" })).toBe(false);
    expect(isReadOnlyToolCall({ command: "create" })).toBe(false);
  });

  it("treats 'undo_edit' as a write (it rewrites the file's previous contents)", () => {
    expect(isReadOnlyToolCall({ command: "undo_edit" })).toBe(false);
    expect(isReadOnlyToolCall({ command: "Undo_Edit" })).toBe(false);
  });

  it("returns false when no rawInput or no command", () => {
    expect(isReadOnlyToolCall(undefined)).toBe(false);
    expect(isReadOnlyToolCall({})).toBe(false);
    expect(isReadOnlyToolCall({ path: "/some/file" })).toBe(false);
  });
});

// --- Option helpers ---

const sampleOptions: PermissionOption[] = [
  { optionId: "allow", kind: "allow_once", name: "Allow" },
  { optionId: "allow-always", kind: "allow_always", name: "Always Allow" },
  { optionId: "reject", kind: "reject_once", name: "Reject" },
  { optionId: "reject-always", kind: "reject_always", name: "Always Reject" },
];

describe("findAllowOnceOptionId", () => {
  it("returns the allow_once option id", () => {
    expect(findAllowOnceOptionId(sampleOptions)).toBe("allow");
  });

  it("returns undefined when no allow_once option exists", () => {
    const noAllow = sampleOptions.filter((o) => o.kind !== "allow_once");
    expect(findAllowOnceOptionId(noAllow)).toBeUndefined();
  });
});

describe("isAcceptOption", () => {
  // OpenCode's option ids carry no "allow"/"reject" wording.
  const opencodeOptions: PermissionOption[] = [
    { optionId: "once", kind: "allow_once", name: "Allow once" },
    { optionId: "always", kind: "allow_always", name: "Always allow" },
    { optionId: "reject", kind: "reject_once", name: "Reject" },
  ];

  it("judges by the selected option's kind, not its id", () => {
    expect(isAcceptOption(opencodeOptions, "once")).toBe(true);
    expect(isAcceptOption(opencodeOptions, "always")).toBe(true);
    expect(isAcceptOption(opencodeOptions, "reject")).toBe(false);
    expect(isAcceptOption(sampleOptions, "allow")).toBe(true);
    expect(isAcceptOption(sampleOptions, "reject-always")).toBe(false);
  });

  it("treats an unknown option id as a rejection", () => {
    expect(isAcceptOption(opencodeOptions, "allow")).toBe(false);
    expect(isAcceptOption([], "once")).toBe(false);
  });
});

describe("filterPermissionOptions", () => {
  it("keeps only allow_once and reject_once", () => {
    const filtered = filterPermissionOptions(sampleOptions);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((o) => o.kind)).toEqual(["allow_once", "reject_once"]);
  });

  it("returns empty array when no once options exist", () => {
    const alwaysOnly = sampleOptions.filter(
      (o) => o.kind === "allow_always" || o.kind === "reject_always",
    );
    expect(filterPermissionOptions(alwaysOnly)).toHaveLength(0);
  });
});
