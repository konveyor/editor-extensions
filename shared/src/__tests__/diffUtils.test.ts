import { expect } from "expect";
import {
  normalizeLineEndings,
  isOnlyLineEndingDiff,
  normalizeUnifiedDiff,
  hasNoMeaningfulDiffContent,
  filterLineEndingOnlyChanges,
  combineIdenticalTrimmedLines,
  cleanDiff,
} from "../utils/diffUtils";

describe("diffUtils", () => {
  describe("normalizeLineEndings()", () => {
    it("should convert CRLF to LF", () => {
      const input = "line1\r\nline2\r\nline3\r\n";
      const expected = "line1\nline2\nline3\n";
      expect(normalizeLineEndings(input)).toBe(expected);
    });

    it("should convert CR to LF", () => {
      const input = "line1\rline2\rline3\r";
      const expected = "line1\nline2\nline3\n";
      expect(normalizeLineEndings(input)).toBe(expected);
    });

    it("should preserve LF", () => {
      const input = "line1\nline2\nline3\n";
      const expected = "line1\nline2\nline3\n";
      expect(normalizeLineEndings(input)).toBe(expected);
    });

    it("should handle mixed line endings", () => {
      const input = "line1\r\nline2\nline3\r";
      const expected = "line1\nline2\nline3\n";
      expect(normalizeLineEndings(input)).toBe(expected);
    });

    it("should handle empty string", () => {
      const input = "";
      const expected = "";
      expect(normalizeLineEndings(input)).toBe(expected);
    });
  });

  describe("isOnlyLineEndingDiff()", () => {
    describe("block-style diffs", () => {
      it("should detect line-ending-only changes in block-style format", () => {
        const diff = `@@ -1,3 +1,3 @@
-line one\r
-line two\r
-line three\r
+line one
+line two
+line three`;
        expect(isOnlyLineEndingDiff(diff)).toBe(true);
      });

      it("should reject block-style diffs with content changes", () => {
        const diff = `@@ -1,3 +1,3 @@
-line one\r
-line two\r
-line three\r
+line one modified
+line two
+line three`;
        expect(isOnlyLineEndingDiff(diff)).toBe(false);
      });

      it("should reject block-style diffs with unequal line counts", () => {
        const diff = `@@ -1,3 +1,2 @@
-line one\r
-line two\r
-line three\r
+line one
+line two`;
        expect(isOnlyLineEndingDiff(diff)).toBe(false);
      });
    });

    describe("special markers", () => {
      it("should detect line-ending-only changes with No newline marker", () => {
        const diff = `@@ -1 +1 @@
-content
\\ No newline at end of file
+content`;
        expect(isOnlyLineEndingDiff(diff)).toBe(true);
      });

      it("should handle marker appearing between changes", () => {
        const diff = `@@ -1,2 +1,2 @@
-line1
\\ No newline at end of file
+line1
+line2`;
        expect(isOnlyLineEndingDiff(diff)).toBe(false);
      });
    });

    describe("paired diffs (legacy behavior)", () => {
      it("should detect line-ending-only changes in alternating pairs", () => {
        const diff = `@@ -1,2 +1,2 @@
-line1\r
+line1
-line2\r
+line2`;
        expect(isOnlyLineEndingDiff(diff)).toBe(true);
      });

      it("should reject paired diffs with content changes", () => {
        const diff = `@@ -1,2 +1,2 @@
-line1
+line1 modified
-line2
+line2`;
        expect(isOnlyLineEndingDiff(diff)).toBe(false);
      });

      it("should handle paired diffs with trailing whitespace differences", () => {
        const diff = `@@ -1,2 +1,2 @@
-line1   
+line1
-line2   
+line2`;
        expect(isOnlyLineEndingDiff(diff)).toBe(true);
      });
    });

    describe("edge cases", () => {
      it("should handle empty diff", () => {
        const diff = "";
        expect(isOnlyLineEndingDiff(diff)).toBe(false);
      });

      it("should handle header-only diff", () => {
        const diff = `diff --git a/file.txt b/file.txt
index 1234567..abcdefg 100644
--- a/file.txt
+++ b/file.txt`;
        expect(isOnlyLineEndingDiff(diff)).toBe(false);
      });

      it("should handle context-only diff", () => {
        const diff = `@@ -1,3 +1,3 @@
 line one
 line two
 line three`;
        expect(isOnlyLineEndingDiff(diff)).toBe(false);
      });

      it("should detect trailing whitespace-only differences", () => {
        const diff = `@@ -1,2 +1,2 @@
-line1\t\t
+line1
-line2
+line2`;
        expect(isOnlyLineEndingDiff(diff)).toBe(true);
      });
    });
  });

  describe("filterLineEndingOnlyChanges()", () => {
    describe("stateful hunk processing", () => {
      it("should filter block-style line-ending-only changes completely", () => {
        const input = [
          "@@ -1,3 +1,3 @@",
          "-line one\r",
          "-line two\r",
          "-line three\r",
          "+line one",
          "+line two",
          "+line three",
        ];
        const result = filterLineEndingOnlyChanges(input);
        expect(result).toEqual(["@@ -1,3 +1,3 @@"]);
      });

      it("should preserve block-style real content changes", () => {
        const input = [
          "@@ -1,3 +1,3 @@",
          "-line one",
          "-line two",
          "-line three",
          "+line one modified",
          "+line two",
          "+line three",
        ];
        const result = filterLineEndingOnlyChanges(input);
        expect(result).toEqual(input);
      });

      it("should preserve context lines between blocks", () => {
        const input = ["@@ -1,5 +1,5 @@", "-old1\r", "+old1", " context line", "-old2\r", "+old2"];
        const result = filterLineEndingOnlyChanges(input);
        expect(result).toEqual(["@@ -1,5 +1,5 @@", " context line"]);
      });
    });

    describe("special markers", () => {
      it("should filter No newline at end of file markers", () => {
        const input = ["@@ -1 +1 @@", "-content", "\\ No newline at end of file", "+content"];
        const result = filterLineEndingOnlyChanges(input);
        expect(result).toEqual(["@@ -1 +1 @@"]);
      });

      it("should preserve other backslash markers", () => {
        const input = ["@@ -1 +1 @@", "-content", "\\ Some other marker", "+content"];
        const result = filterLineEndingOnlyChanges(input);
        // When marker appears between - and + lines, they're not collected as a pair
        expect(result).toEqual(["@@ -1 +1 @@", "-content", "\\ Some other marker", "+content"]);
      });
    });

    describe("multiple hunks", () => {
      it("should handle two hunks with one filtered and one preserved", () => {
        const input = [
          "@@ -1,2 +1,2 @@",
          "-line1\r",
          "+line1",
          "-line2\r",
          "+line2",
          "@@ -10,2 +10,2 @@",
          "-real change",
          "+different content",
        ];
        const result = filterLineEndingOnlyChanges(input);
        expect(result).toEqual([
          "@@ -1,2 +1,2 @@",
          "@@ -10,2 +10,2 @@",
          "-real change",
          "+different content",
        ]);
      });
    });

    describe("edge cases", () => {
      it("should handle empty input", () => {
        const input: string[] = [];
        const result = filterLineEndingOnlyChanges(input);
        expect(result).toEqual([]);
      });

      it("should preserve diff headers", () => {
        const input = [
          "diff --git a/file.txt b/file.txt",
          "index 1234567..abcdefg 100644",
          "--- a/file.txt",
          "+++ b/file.txt",
          "@@ -1 +1 @@",
          "-line\r",
          "+line",
        ];
        const result = filterLineEndingOnlyChanges(input);
        expect(result).toEqual([
          "diff --git a/file.txt b/file.txt",
          "index 1234567..abcdefg 100644",
          "--- a/file.txt",
          "+++ b/file.txt",
          "@@ -1 +1 @@",
        ]);
      });

      it("should preserve all when unequal block sizes", () => {
        const input = ["@@ -1,3 +1,2 @@", "-line1\r", "-line2\r", "-line3\r", "+line1", "+line2"];
        const result = filterLineEndingOnlyChanges(input);
        expect(result).toEqual(input);
      });

      it("should handle context lines", () => {
        const input = ["@@ -1,3 +1,3 @@", " context1", " context2", " context3"];
        const result = filterLineEndingOnlyChanges(input);
        expect(result).toEqual(input);
      });
    });
  });

  describe("combineIdenticalTrimmedLines()", () => {
    it("should combine consecutive -/+ pairs with identical trimmed content", () => {
      const input = ["@@ -1,2 +1,2 @@", "-  line1", "+line1", "-line2  ", "+line2"];
      const result = combineIdenticalTrimmedLines(input);
      expect(result).toEqual(["@@ -1,2 +1,2 @@", "   line1", " line2  "]);
    });

    it("should preserve real content differences", () => {
      const input = ["@@ -1,2 +1,2 @@", "-line1", "+line1 modified", "-line2", "+line2 changed"];
      const result = combineIdenticalTrimmedLines(input);
      expect(result).toEqual(input);
    });

    it("should combine leading whitespace differences", () => {
      const input = ["@@ -1 +1 @@", "-   indented", "+indented"];
      const result = combineIdenticalTrimmedLines(input);
      expect(result).toEqual(["@@ -1 +1 @@", "    indented"]);
    });

    it("should combine trailing whitespace differences", () => {
      const input = ["@@ -1 +1 @@", "-trailing   ", "+trailing"];
      const result = combineIdenticalTrimmedLines(input);
      expect(result).toEqual(["@@ -1 +1 @@", " trailing   "]);
    });

    it("should combine tab vs space differences", () => {
      const input = ["@@ -1 +1 @@", "-\t\tcode", "+    code"];
      const result = combineIdenticalTrimmedLines(input);
      expect(result).toEqual(["@@ -1 +1 @@", " \t\tcode"]);
    });

    it("should not combine non-consecutive pairs", () => {
      const input = ["@@ -1,3 +1,3 @@", "-line1  ", " context", "+line1"];
      const result = combineIdenticalTrimmedLines(input);
      expect(result).toEqual(input);
    });

    it("should combine empty lines", () => {
      const input = ["@@ -1 +1 @@", "-   ", "+"];
      const result = combineIdenticalTrimmedLines(input);
      expect(result).toEqual(["@@ -1 +1 @@", "    "]);
    });

    it("should handle mixed scenarios with some combined and some preserved", () => {
      const input = [
        "@@ -1,4 +1,4 @@",
        "-  line1",
        "+line1",
        "-line2",
        "+line2 modified",
        "-line3  ",
        "+line3",
      ];
      const result = combineIdenticalTrimmedLines(input);
      expect(result).toEqual([
        "@@ -1,4 +1,4 @@",
        "   line1",
        "-line2",
        "+line2 modified",
        " line3  ",
      ]);
    });
  });

  describe("normalizeUnifiedDiff()", () => {
    it("should return empty string when contents match after normalization", () => {
      const diff = "@@ -1 +1 @@\n-line\r\n+line\n";
      const original = "line\r\n";
      const newContent = "line\n";
      expect(normalizeUnifiedDiff(diff, original, newContent)).toBe("");
    });

    it("should return original diff when contents differ", () => {
      const diff = "@@ -1 +1 @@\n-old content\n+new content\n";
      const original = "old content";
      const newContent = "new content";
      expect(normalizeUnifiedDiff(diff, original, newContent)).toBe(diff);
    });

    it("should handle empty original content", () => {
      const diff = "@@ -0,0 +1 @@\n+new line\n";
      const original = "";
      const newContent = "new line\n";
      expect(normalizeUnifiedDiff(diff, original, newContent)).toBe(diff);
    });

    it("should handle empty new content", () => {
      const diff = "@@ -1 +0,0 @@\n-old line\n";
      const original = "old line\n";
      const newContent = "";
      expect(normalizeUnifiedDiff(diff, original, newContent)).toBe(diff);
    });

    it("should return empty string when both contents are empty", () => {
      const diff = "";
      const original = "";
      const newContent = "";
      expect(normalizeUnifiedDiff(diff, original, newContent)).toBe("");
    });
  });

  describe("hasNoMeaningfulDiffContent()", () => {
    it("should return true for empty string", () => {
      expect(hasNoMeaningfulDiffContent("")).toBe(true);
    });

    it("should return true for whitespace-only", () => {
      expect(hasNoMeaningfulDiffContent("   \n\t\n   ")).toBe(true);
    });

    it("should return true for header-only diff", () => {
      const diff = `diff --git a/file.txt b/file.txt
index 1234567..abcdefg 100644
--- a/file.txt
+++ b/file.txt`;
      expect(hasNoMeaningfulDiffContent(diff)).toBe(true);
    });

    it("should return false for context-only diff", () => {
      const diff = `@@ -1,3 +1,3 @@
 line one
 line two
 line three`;
      // Context lines are preserved and considered content
      expect(hasNoMeaningfulDiffContent(diff)).toBe(false);
    });

    it("should return false for diff with changes", () => {
      const diff = `@@ -1,2 +1,2 @@
-old line
+new line`;
      expect(hasNoMeaningfulDiffContent(diff)).toBe(false);
    });

    it("should return false after filtering line-ending-only changes", () => {
      const diff = `@@ -1,2 +1,2 @@
-line1\r
+line1
-line2\r
+line2`;
      // Hunk header remains after filtering, which is counted as content
      expect(hasNoMeaningfulDiffContent(diff)).toBe(false);
    });
  });

  describe("cleanDiff()", () => {
    describe("integration", () => {
      it("should return empty string for line-ending-only diffs", () => {
        const diff = `@@ -1,3 +1,3 @@
-line one\r
-line two\r
-line three\r
+line one
+line two
+line three`;
        expect(cleanDiff(diff)).toBe("");
      });

      it("should preserve whitespace changes as they are not line-ending-only", () => {
        const diff = `@@ -1,2 +1,2 @@
-  line1
+line1
-line2
+line2`;
        const result = cleanDiff(diff);
        // Whitespace changes are not line-ending changes, so they're preserved
        // filterLineEndingOnlyChanges reorders them to block-style
        expect(result).not.toBe("");
        expect(result).toContain("-  line1");
        expect(result).toContain("+line1");
        expect(result).toContain("-line2");
        expect(result).toContain("+line2");
      });

      it("should preserve real content changes", () => {
        const diff = `@@ -1,2 +1,2 @@
-const foo = 'bar';
+const foo = 'baz';`;
        const result = cleanDiff(diff);
        expect(result).not.toBe("");
        expect(result).toContain("-const foo = 'bar';");
        expect(result).toContain("+const foo = 'baz';");
      });

      it("should preserve all changes in a hunk when any change is real content", () => {
        const diff = `@@ -1,4 +1,4 @@
-line1\r
+line1
-line2\r
+line2
-old content
+new content`;
        const result = cleanDiff(diff);
        expect(result).not.toBe("");
        expect(result).toContain("-old content");
        expect(result).toContain("+new content");
        // Line-ending-only changes in the same hunk are preserved because
        // the stateful processor keeps all changes when any pair has real content
        expect(result).toContain("line1");
      });
    });

    describe("empty string return", () => {
      it("should return empty string for empty input", () => {
        expect(cleanDiff("")).toBe("");
      });

      it("should return empty string for whitespace-only input", () => {
        expect(cleanDiff("   \n\t\n   ")).toBe("");
      });

      it("should return empty string for header-only diff", () => {
        const diff = `diff --git a/file.txt b/file.txt
index 1234567..abcdefg 100644
--- a/file.txt
+++ b/file.txt`;
        expect(cleanDiff(diff)).toBe("");
      });

      it("should return empty string when all changes are filtered", () => {
        const diff = `@@ -1,2 +1,2 @@
-line1\r
+line1
-line2\r
+line2`;
        expect(cleanDiff(diff)).toBe("");
      });
    });

    describe("complex scenarios", () => {
      it("should handle multiple hunks with mixed changes", () => {
        const diff = `@@ -1,2 +1,2 @@
-line1\r
+line1
-line2\r
+line2
@@ -10,2 +10,2 @@
-real change
+different content`;
        const result = cleanDiff(diff);
        expect(result).not.toBe("");
        expect(result).toContain("-real change");
        expect(result).toContain("+different content");
      });

      it("should handle no-newline markers", () => {
        const diff = `@@ -1 +1 @@
-content
\\ No newline at end of file
+content`;
        expect(cleanDiff(diff)).toBe("");
      });

      it("should preserve headers when meaningful changes remain", () => {
        const diff = `diff --git a/file.txt b/file.txt
index 1234567..abcdefg 100644
--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,2 @@
-old
+new`;
        const result = cleanDiff(diff);
        expect(result).not.toBe("");
        expect(result).toContain("-old");
        expect(result).toContain("+new");
      });

      it("should preserve all changes in a hunk with mixed line-ending and whitespace changes", () => {
        const diff = `@@ -1,4 +1,4 @@
-line1\r
+line1
-  indented
+indented
-real old
+real new`;
        const result = cleanDiff(diff);
        expect(result).not.toBe("");
        expect(result).toContain("-real old");
        expect(result).toContain("+real new");
        // All changes in the hunk are preserved when there's real content change
        expect(result).toContain("line1");
        expect(result).toContain("indented");
      });
    });
  });
});
