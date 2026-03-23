import expect from "expect";
import type { ToolPermissionPolicy } from "@editor-extensions/shared";
import {
  resolvePermission,
  isReadOnlyToolCall,
  policyToGooseMode,
  shouldAutoApproveWithPolicy,
  shouldDenyWithPolicy,
} from "../toolPermissionPolicy";
import type { PermissionRequestData } from "../../../client/agentClient";

// --- Helpers ---

function makePermData(toolName: string, rawInput?: Record<string, unknown>): PermissionRequestData {
  return {
    requestId: 1,
    title: toolName,
    toolName,
    toolCallId: "tc-1",
    kind: "tool_permission",
    status: "pending",
    rawInput,
    options: [
      { optionId: "allow", kind: "allow_once" as const, name: "Allow" },
      { optionId: "reject", kind: "reject_once" as const, name: "Reject" },
    ],
  };
}

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

// --- policyToGooseMode ---

describe("policyToGooseMode", () => {
  it("always returns 'approve' regardless of policy", () => {
    const policies: ToolPermissionPolicy[] = [
      { autonomyLevel: "auto" },
      { autonomyLevel: "ask" },
      { autonomyLevel: "smart" },
      { autonomyLevel: "smart", overrides: { commandExecution: "auto" } },
    ];
    for (const policy of policies) {
      expect(policyToGooseMode(policy)).toBe("approve");
    }
  });
});

// --- resolvePermission ---

describe("resolvePermission", () => {
  describe("read-only bypass", () => {
    it("always returns 'auto' for view commands regardless of policy", () => {
      const policies: ToolPermissionPolicy[] = [
        { autonomyLevel: "ask" },
        { autonomyLevel: "smart" },
        { autonomyLevel: "auto" },
      ];
      for (const policy of policies) {
        expect(resolvePermission(policy, "text_editor", { command: "view" })).toBe("auto");
        expect(resolvePermission(policy, "Developer: Text Editor", { command: "view" })).toBe(
          "auto",
        );
      }
    });

    it("returns 'auto' for view even with a fileEditing deny override", () => {
      const policy: ToolPermissionPolicy = {
        autonomyLevel: "ask",
        overrides: { fileEditing: "deny" },
      };
      expect(resolvePermission(policy, "text_editor", { command: "view" })).toBe("auto");
    });
  });

  describe("ask mode", () => {
    const policy: ToolPermissionPolicy = { autonomyLevel: "ask" };

    it("returns 'ask' for file editing", () => {
      expect(resolvePermission(policy, "text_editor", { command: "str_replace" })).toBe("ask");
    });

    it("returns 'ask' for command execution", () => {
      expect(resolvePermission(policy, "bash")).toBe("ask");
    });

    it("returns 'ask' for uncategorized tools", () => {
      expect(resolvePermission(policy, "todo_write")).toBe("ask");
    });
  });

  describe("auto mode", () => {
    const policy: ToolPermissionPolicy = { autonomyLevel: "auto" };

    it("returns 'auto' for everything", () => {
      expect(resolvePermission(policy, "text_editor", { command: "str_replace" })).toBe("auto");
      expect(resolvePermission(policy, "bash")).toBe("auto");
      expect(resolvePermission(policy, "todo_write")).toBe("auto");
    });
  });

  describe("smart mode", () => {
    const policy: ToolPermissionPolicy = { autonomyLevel: "smart" };

    it("returns 'ask' for file editing writes", () => {
      expect(resolvePermission(policy, "text_editor", { command: "str_replace" })).toBe("ask");
      expect(resolvePermission(policy, "Developer: Text Editor", { command: "write" })).toBe("ask");
    });

    it("returns 'ask' for command execution", () => {
      expect(resolvePermission(policy, "bash")).toBe("ask");
      expect(resolvePermission(policy, "Developer: Shell")).toBe("ask");
    });

    it("returns 'auto' for other/uncategorized tools", () => {
      expect(resolvePermission(policy, "todo_write")).toBe("auto");
    });

    it("returns 'auto' for MCP tools", () => {
      expect(resolvePermission(policy, "mcp__some_server")).toBe("auto");
    });

    it("returns 'auto' for web access tools", () => {
      expect(resolvePermission(policy, "webfetch")).toBe("auto");
    });
  });

  describe("per-category overrides", () => {
    it("uses commandExecution override over smart default", () => {
      const policy: ToolPermissionPolicy = {
        autonomyLevel: "smart",
        overrides: { commandExecution: "auto" },
      };
      expect(resolvePermission(policy, "bash")).toBe("auto");
      expect(resolvePermission(policy, "Developer: Shell")).toBe("auto");
    });

    it("uses fileEditing override over smart default", () => {
      const policy: ToolPermissionPolicy = {
        autonomyLevel: "smart",
        overrides: { fileEditing: "auto" },
      };
      expect(resolvePermission(policy, "text_editor", { command: "str_replace" })).toBe("auto");
    });

    it("does not apply overrides to 'other' category", () => {
      const policy: ToolPermissionPolicy = {
        autonomyLevel: "ask",
      };
      expect(resolvePermission(policy, "todo_write")).toBe("ask");
    });
  });
});

// --- shouldAutoApproveWithPolicy / shouldDenyWithPolicy ---

describe("shouldAutoApproveWithPolicy", () => {
  it("returns true when resolved level is auto", () => {
    const policy: ToolPermissionPolicy = { autonomyLevel: "auto" };
    expect(shouldAutoApproveWithPolicy(policy, makePermData("bash"))).toBe(true);
  });

  it("returns false when resolved level is ask", () => {
    const policy: ToolPermissionPolicy = { autonomyLevel: "ask" };
    expect(shouldAutoApproveWithPolicy(policy, makePermData("bash"))).toBe(false);
  });

  it("returns true for read-only tool calls even in ask mode", () => {
    const policy: ToolPermissionPolicy = { autonomyLevel: "ask" };
    expect(
      shouldAutoApproveWithPolicy(policy, makePermData("text_editor", { command: "view" })),
    ).toBe(true);
  });
});

describe("shouldDenyWithPolicy", () => {
  it("returns true when resolved level is deny", () => {
    const policy: ToolPermissionPolicy = {
      autonomyLevel: "smart",
      overrides: { commandExecution: "deny" },
    };
    expect(shouldDenyWithPolicy(policy, makePermData("bash"))).toBe(true);
  });

  it("returns false when resolved level is ask", () => {
    const policy: ToolPermissionPolicy = { autonomyLevel: "ask" };
    expect(shouldDenyWithPolicy(policy, makePermData("bash"))).toBe(false);
  });
});
