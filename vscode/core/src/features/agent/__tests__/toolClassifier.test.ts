import expect from "expect";
import { classifyTool } from "../toolClassifier";

describe("classifyTool", () => {
  describe("simple tool names", () => {
    it("classifies standard file editing tools", () => {
      expect(classifyTool("edit")).toBe("fileEditing");
      expect(classifyTool("write")).toBe("fileEditing");
      expect(classifyTool("text_editor")).toBe("fileEditing");
      expect(classifyTool("apply_patch")).toBe("fileEditing");
      expect(classifyTool("str_replace_editor")).toBe("fileEditing");
      expect(classifyTool("create")).toBe("fileEditing");
    });

    it("classifies command execution tools", () => {
      expect(classifyTool("bash")).toBe("commandExecution");
      expect(classifyTool("shell")).toBe("commandExecution");
      expect(classifyTool("terminal")).toBe("commandExecution");
      expect(classifyTool("execute")).toBe("commandExecution");
      expect(classifyTool("run_command")).toBe("commandExecution");
    });

    it("classifies web access tools", () => {
      expect(classifyTool("webfetch")).toBe("webAccess");
      expect(classifyTool("web_search")).toBe("webAccess");
      expect(classifyTool("curl")).toBe("webAccess");
      expect(classifyTool("fetch")).toBe("webAccess");
      expect(classifyTool("http")).toBe("webAccess");
    });

    it("classifies MCP tools by prefix", () => {
      expect(classifyTool("mcp__my_tool")).toBe("mcpTools");
      expect(classifyTool("mcp_some_server")).toBe("mcpTools");
    });

    it("returns 'other' for unrecognized tools", () => {
      expect(classifyTool("todo_write")).toBe("other");
      expect(classifyTool("some_random_tool")).toBe("other");
    });
  });

  describe("case insensitivity", () => {
    it("normalizes tool names to lowercase", () => {
      expect(classifyTool("BASH")).toBe("commandExecution");
      expect(classifyTool("Text_Editor")).toBe("fileEditing");
      expect(classifyTool("WebFetch")).toBe("webAccess");
    });
  });

  describe("Goose-style colon-prefixed names", () => {
    it("classifies 'Developer: Text Editor' with write command as fileEditing", () => {
      expect(classifyTool("Developer: Text Editor", { command: "str_replace" })).toBe(
        "fileEditing",
      );
      expect(classifyTool("Developer: Text Editor", { command: "write" })).toBe("fileEditing");
      expect(classifyTool("Developer: Text Editor", { command: "create" })).toBe("fileEditing");
      expect(classifyTool("Developer: Text Editor", { command: "insert" })).toBe("fileEditing");
    });

    it("classifies 'Developer: Text Editor' with no command as fileEditing", () => {
      expect(classifyTool("Developer: Text Editor")).toBe("fileEditing");
      expect(classifyTool("Developer: Text Editor", {})).toBe("fileEditing");
    });

    it("classifies 'Developer: Shell' as commandExecution", () => {
      expect(classifyTool("Developer: Shell")).toBe("commandExecution");
      expect(classifyTool("developer: shell")).toBe("commandExecution");
    });

    it("handles varied casing in Goose-style names", () => {
      expect(classifyTool("DEVELOPER: TEXT EDITOR", { command: "write" })).toBe("fileEditing");
      expect(classifyTool("developer: bash")).toBe("commandExecution");
    });
  });

  describe("read-only Text Editor commands", () => {
    it("classifies 'view' command as 'other' (not fileEditing)", () => {
      expect(classifyTool("text_editor", { command: "view" })).toBe("other");
      expect(classifyTool("Developer: Text Editor", { command: "view" })).toBe("other");
    });

    it("classifies 'undo_edit' command as 'other'", () => {
      expect(classifyTool("text_editor", { command: "undo_edit" })).toBe("other");
      expect(classifyTool("Developer: Text Editor", { command: "undo_edit" })).toBe("other");
    });

    it("is case-insensitive for read-only commands", () => {
      expect(classifyTool("text_editor", { command: "VIEW" })).toBe("other");
      expect(classifyTool("text_editor", { command: "View" })).toBe("other");
    });

    it("does not affect non-Text-Editor tools", () => {
      // A "view" command on a shell tool should still be commandExecution
      expect(classifyTool("bash", { command: "view" })).toBe("commandExecution");
    });
  });
});
