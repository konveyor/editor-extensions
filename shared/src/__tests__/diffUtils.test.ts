import {
  normalizeLineEndings,
  isOnlyLineEndingDiff,
  normalizeUnifiedDiff,
  hasNoMeaningfulDiffContent,
  filterLineEndingOnlyChanges,
  combineIdenticalTrimmedLines,
  cleanDiff,
} from "../utils/diffUtils";
import { expect } from "expect";

describe("diffUtils", () => {
  describe("normalizeLineEndings", () => {
    it("should convert CRLF to LF", () => {
      const input = "line1\r\nline2\r\nline3";
      expect(normalizeLineEndings(input)).toBe("line1\nline2\nline3");
    });

    it("should convert CR to LF", () => {
      const input = "line1\rline2\rline3";
      expect(normalizeLineEndings(input)).toBe("line1\nline2\nline3");
    });

    it("should preserve existing LF", () => {
      const input = "line1\nline2\nline3";
      expect(normalizeLineEndings(input)).toBe("line1\nline2\nline3");
    });

    it("should handle mixed line endings", () => {
      const input = "line1\r\nline2\rline3\nline4";
      expect(normalizeLineEndings(input)).toBe("line1\nline2\nline3\nline4");
    });

    it("should handle empty string", () => {
      expect(normalizeLineEndings("")).toBe("");
    });

    it("should handle string without line endings", () => {
      expect(normalizeLineEndings("single line")).toBe("single line");
    });
  });

  describe("isOnlyLineEndingDiff", () => {
    it("should return true for diff with only line ending changes", () => {
      // Note: In a real diff, CRLF is represented as \r at line end before newline
      // This is a simplified test showing identical content
      const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,2 @@
-line1
+line1
-line2
+line2`;
      expect(isOnlyLineEndingDiff(diff)).toBe(true);
    });

    it("should return false for diff with actual content changes", () => {
      const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,2 @@
-line1
+modified_line1
-line2
+line2`;
      expect(isOnlyLineEndingDiff(diff)).toBe(false);
    });

    it('should return true when only special marker "No newline at end of file" exists', () => {
      const diff = `--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
 line1
\\ No newline at end of file`;
      expect(isOnlyLineEndingDiff(diff)).toBe(true);
    });

    it("should return false for empty diff", () => {
      expect(isOnlyLineEndingDiff("")).toBe(false);
    });

    it("should handle block-style diffs where all removed lines appear before added lines", () => {
      const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
-line1
-line2
-line3
+line1
+line2
+line3`;
      expect(isOnlyLineEndingDiff(diff)).toBe(true);
    });

    it("should return false for block-style diff with actual changes", () => {
      const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
-line1
-line2
-line3
+line1_modified
+line2
+line3`;
      expect(isOnlyLineEndingDiff(diff)).toBe(false);
    });

    it("should handle trailing whitespace differences as line ending changes", () => {
      const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,2 @@
-line1  
+line1
-line2	
+line2`;
      // Lines differ only in trailing whitespace - should be treated as line ending change
      expect(isOnlyLineEndingDiff(diff)).toBe(true);
    });
  });

  describe("filterLineEndingOnlyChanges", () => {
    it("should filter out line-ending-only changes", () => {
      const lines = [
        "--- a/file.txt",
        "+++ b/file.txt",
        "@@ -1,2 +1,2 @@",
        "-line1",
        "+line1",
        " context",
      ];
      const filtered = filterLineEndingOnlyChanges(lines);
      // Should remove the -line1/+line1 pair since they're identical
      expect(filtered).not.toContain("-line1");
      expect(filtered).not.toContain("+line1");
      expect(filtered).toContain(" context");
    });

    it("should keep actual content changes", () => {
      const lines = [
        "--- a/file.txt",
        "+++ b/file.txt",
        "@@ -1,2 +1,2 @@",
        "-old_content",
        "+new_content",
        " context",
      ];
      const filtered = filterLineEndingOnlyChanges(lines);
      expect(filtered).toContain("-old_content");
      expect(filtered).toContain("+new_content");
    });

    it('should filter out "No newline at end of file" markers', () => {
      const lines = [
        "--- a/file.txt",
        "+++ b/file.txt",
        "@@ -1 +1 @@",
        " line1",
        "\\ No newline at end of file",
      ];
      const filtered = filterLineEndingOnlyChanges(lines);
      expect(filtered).not.toContain("\\ No newline at end of file");
    });

    it("should handle block-style diffs with all removed before all added", () => {
      const lines = [
        "--- a/file.txt",
        "+++ b/file.txt",
        "@@ -1,3 +1,3 @@",
        "-line1",
        "-line2",
        "-line3",
        "+line1",
        "+line2",
        "+line3",
      ];
      const filtered = filterLineEndingOnlyChanges(lines);
      // All pairs should be filtered out as they're identical
      expect(filtered).not.toContain("-line1");
      expect(filtered).not.toContain("+line1");
    });

    it("should keep block-style diffs with actual content changes", () => {
      const lines = [
        "--- a/file.txt",
        "+++ b/file.txt",
        "@@ -1,3 +1,3 @@",
        "-line1",
        "-line2",
        "-line3",
        "+line1_modified",
        "+line2",
        "+line3",
      ];
      const filtered = filterLineEndingOnlyChanges(lines);
      // Should keep all lines since there's a real change
      expect(filtered).toContain("-line1");
      expect(filtered).toContain("+line1_modified");
    });

    it("should handle mixed content and line-ending changes in same hunk", () => {
      const lines = [
        "--- a/file.txt",
        "+++ b/file.txt",
        "@@ -1,4 +1,4 @@",
        "-line1",
        "+line1",
        "-old_content",
        "+new_content",
      ];
      const filtered = filterLineEndingOnlyChanges(lines);
      // Since not all pairs are identical, all changes should be kept
      expect(filtered).toContain("-line1");
      expect(filtered).toContain("+line1");
      expect(filtered).toContain("-old_content");
      expect(filtered).toContain("+new_content");
    });

    it("should preserve header lines", () => {
      const lines = [
        "diff --git a/file.txt b/file.txt",
        "index abc123..def456 100644",
        "--- a/file.txt",
        "+++ b/file.txt",
        "@@ -1 +1 @@",
        "-content",
        "+content",
      ];
      const filtered = filterLineEndingOnlyChanges(lines);
      expect(filtered[0]).toBe("diff --git a/file.txt b/file.txt");
      expect(filtered[1]).toBe("index abc123..def456 100644");
      expect(filtered[2]).toBe("--- a/file.txt");
      expect(filtered[3]).toBe("+++ b/file.txt");
    });

    it("should handle multiple hunks", () => {
      const lines = [
        "--- a/file.txt",
        "+++ b/file.txt",
        "@@ -1,2 +1,2 @@",
        "-line1",
        "+line1",
        " context",
        "@@ -10,2 +10,2 @@",
        "-line10",
        "+line10_changed",
        " more context",
      ];
      const filtered = filterLineEndingOnlyChanges(lines);
      // First hunk should be filtered, second should be kept
      expect(filtered).toContain("-line10");
      expect(filtered).toContain("+line10_changed");
    });
  });

  describe("combineIdenticalTrimmedLines", () => {
    it("should combine consecutive -/+ pairs that are identical after trimming", () => {
      const lines = ["-  line with spaces  ", "+line with spaces", " context"];
      const combined = combineIdenticalTrimmedLines(lines);
      expect(combined).toHaveLength(2);
      expect(combined[0]).toBe("   line with spaces  ");
      expect(combined[1]).toBe(" context");
    });

    it("should keep pairs that differ after trimming", () => {
      const lines = ["-old content", "+new content"];
      const combined = combineIdenticalTrimmedLines(lines);
      expect(combined).toHaveLength(2);
      expect(combined[0]).toBe("-old content");
      expect(combined[1]).toBe("+new content");
    });

    it("should handle non-consecutive changes", () => {
      const lines = ["-old", " context", "+new"];
      const combined = combineIdenticalTrimmedLines(lines);
      expect(combined).toEqual(lines);
    });

    it("should handle multiple pairs", () => {
      const lines = ["-  line1  ", "+line1", "-  line2  ", "+line2"];
      const combined = combineIdenticalTrimmedLines(lines);
      expect(combined).toHaveLength(2);
    });
  });

  describe("hasNoMeaningfulDiffContent", () => {
    it("should return true for empty diff", () => {
      expect(hasNoMeaningfulDiffContent("")).toBe(true);
    });

    it("should return true for whitespace-only diff", () => {
      expect(hasNoMeaningfulDiffContent("   \n  \n")).toBe(true);
    });

    it("should return true for diff with only headers", () => {
      const diff = `--- a/file.txt
+++ b/file.txt`;
      expect(hasNoMeaningfulDiffContent(diff)).toBe(true);
    });

    it("should return true for diff with only context lines", () => {
      const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,2 @@
 line1
 line2`;
      expect(hasNoMeaningfulDiffContent(diff)).toBe(true);
    });

    it("should return false for diff with actual changes", () => {
      const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,2 @@
-old
+new
 line2`;
      expect(hasNoMeaningfulDiffContent(diff)).toBe(false);
    });
  });

  describe("normalizeUnifiedDiff", () => {
    it("should return empty string when contents are identical after normalization", () => {
      const diff = "some diff";
      const original = "line1\r\nline2";
      const modified = "line1\nline2";
      expect(normalizeUnifiedDiff(diff, original, modified)).toBe("");
    });

    it("should return original diff when contents actually differ", () => {
      const diff = "the diff content";
      const original = "line1\nline2";
      const modified = "line1\nmodified_line2";
      expect(normalizeUnifiedDiff(diff, original, modified)).toBe(diff);
    });
  });

  describe("cleanDiff", () => {
    it("should return empty string for null/undefined input", () => {
      expect(cleanDiff("")).toBe("");
      expect(cleanDiff("   ")).toBe("");
    });

    it("should return empty string for line-ending-only diff", () => {
      const diff = `--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-line1
+line1`;
      expect(cleanDiff(diff)).toBe("");
    });

    it("should return cleaned diff for mixed changes", () => {
      const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
-unchanged
+unchanged
-old_content
+new_content
 context`;
      const cleaned = cleanDiff(diff);
      // Should contain the actual change but not the line-ending-only change
      expect(cleaned).toContain("+new_content");
      expect(cleaned).toContain("-old_content");
    });

    it("should handle real-world CRLF diff scenario", () => {
      // Simulating a diff where file was converted from CRLF to LF
      const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,4 +1,4 @@
-public class Example {
-    public void method() {
-    }
-}
+public class Example {
+    public void method() {
+    }
+}`;
      const cleaned = cleanDiff(diff);
      // If all lines are identical after normalization, should return empty
      expect(cleaned).toBe("");
    });
  });

  describe("edge cases", () => {
    it("should handle diff with only additions (new file)", () => {
      const lines = [
        "--- /dev/null",
        "+++ b/newfile.txt",
        "@@ -0,0 +1,3 @@",
        "+line1",
        "+line2",
        "+line3",
      ];
      const filtered = filterLineEndingOnlyChanges(lines);
      expect(filtered).toContain("+line1");
      expect(filtered).toContain("+line2");
      expect(filtered).toContain("+line3");
    });

    it("should handle diff with only deletions (deleted file)", () => {
      const lines = [
        "--- a/oldfile.txt",
        "+++ /dev/null",
        "@@ -1,3 +0,0 @@",
        "-line1",
        "-line2",
        "-line3",
      ];
      const filtered = filterLineEndingOnlyChanges(lines);
      expect(filtered).toContain("-line1");
      expect(filtered).toContain("-line2");
      expect(filtered).toContain("-line3");
    });

    it("should handle unbalanced changes (more additions than deletions)", () => {
      const lines = [
        "--- a/file.txt",
        "+++ b/file.txt",
        "@@ -1,2 +1,3 @@",
        "-line1",
        "+line1",
        "+new_line",
        " context",
      ];
      const filtered = filterLineEndingOnlyChanges(lines);
      // Unbalanced - should keep all changes
      expect(filtered).toContain("-line1");
      expect(filtered).toContain("+line1");
      expect(filtered).toContain("+new_line");
    });

    it("should handle unbalanced changes (more deletions than additions)", () => {
      const lines = [
        "--- a/file.txt",
        "+++ b/file.txt",
        "@@ -1,3 +1,2 @@",
        "-line1",
        "-deleted_line",
        "+line1",
        " context",
      ];
      const filtered = filterLineEndingOnlyChanges(lines);
      // Unbalanced - should keep all changes
      expect(filtered).toContain("-line1");
      expect(filtered).toContain("-deleted_line");
      expect(filtered).toContain("+line1");
    });
  });

  describe("isOnlyLineEndingDiff - additional block-style tests", () => {
    it("should return false when additions don't match removals (different order)", () => {
      const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
-line1
-line2
-line3
+line3
+line2
+line1`;
      // Lines are in different order, so this is NOT just a line ending change
      expect(isOnlyLineEndingDiff(diff)).toBe(false);
    });

    it("should handle block diff with trailing whitespace changes", () => {
      const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,2 @@
-line1   
-line2	
+line1
+line2`;
      // Only trailing whitespace differs
      expect(isOnlyLineEndingDiff(diff)).toBe(true);
    });

    it("should return false when one line differs in block", () => {
      const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
-line1
-line2
-line3
+line1
+line2_changed
+line3`;
      expect(isOnlyLineEndingDiff(diff)).toBe(false);
    });

    it("should return false for unbalanced block diff", () => {
      const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,2 @@
-line1
-line2
-line3
+line1
+line2`;
      expect(isOnlyLineEndingDiff(diff)).toBe(false);
    });

    it("should handle empty lines in block diff", () => {
      const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
-
-line2
-
+
+line2
+`;
      expect(isOnlyLineEndingDiff(diff)).toBe(true);
    });
  });

  describe("real-world scenarios", () => {
    it("should handle Java file with CRLF to LF conversion", () => {
      // Simulating a Java file that was saved with different line endings
      const diff = `--- a/Example.java
+++ b/Example.java
@@ -1,5 +1,5 @@
-package com.example;
-
-public class Example {
-    
-}
+package com.example;
+
+public class Example {
+    
+}`;
      expect(isOnlyLineEndingDiff(diff)).toBe(true);
    });

    it("should not filter out actual code changes", () => {
      const diff = `--- a/Example.java
+++ b/Example.java
@@ -1,5 +1,6 @@
-package com.example;
-
-public class Example {
-    
-}
+package com.example;
+
+public class Example {
+    public void newMethod() {}
+}`;
      expect(isOnlyLineEndingDiff(diff)).toBe(false);
    });

    it("should handle multiple hunks with mixed changes", () => {
      const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
-line1
-line2
-line3
+line1
+line2
+line3
@@ -10,3 +10,3 @@
-line10
-line11
-line12
+line10_changed
+line11
+line12`;
      // Second hunk has real change, so overall it's not just line ending
      expect(isOnlyLineEndingDiff(diff)).toBe(false);
    });
  });
});
