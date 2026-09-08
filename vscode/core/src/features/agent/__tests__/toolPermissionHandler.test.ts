import expect from "expect";
import {
  isReadOnlyToolCall,
  findAllowOnceOptionId,
  filterPermissionOptions,
} from "../toolPermissionPolicy";
import type { PermissionOption } from "../../../client/agentClient";

// --- isReadOnlyToolCall ---

describe("isReadOnlyToolCall", () => {
  it("returns true for 'view' command", () => {
    expect(isReadOnlyToolCall({ command: "view" })).toBe(true);
  });

  it("returns true for 'undo_edit' command", () => {
    expect(isReadOnlyToolCall({ command: "undo_edit" })).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isReadOnlyToolCall({ command: "VIEW" })).toBe(true);
    expect(isReadOnlyToolCall({ command: "Undo_Edit" })).toBe(true);
  });

  it("returns false for write commands", () => {
    expect(isReadOnlyToolCall({ command: "str_replace" })).toBe(false);
    expect(isReadOnlyToolCall({ command: "write" })).toBe(false);
    expect(isReadOnlyToolCall({ command: "create" })).toBe(false);
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
