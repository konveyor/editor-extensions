import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import hljs from "highlight.js";
import {
  detectLanguage,
  isLanguageSupported,
} from "../../../../../shared/src/utils/languageMapping";
import { applyTheme, watchThemeChanges } from "../../../utils/syntaxHighlightingTheme";

// Re-enabling CSS import to test if this breaks re-rendering
import "./enhancedSyntaxHighlighting.css";

interface DiffLine {
  type: "addition" | "deletion" | "context" | "meta";
  content: string;
  lineNumber: string;
  originalIndex: number;
}

interface EnhancedDiffRendererProps {
  diffContent: string;
  filePath: string;
  content?: string;
  maxHeight?: number; // Maximum height in pixels for virtualization
  lineHeight?: number; // Height of each line in pixels
  enableVirtualization?: boolean; // Whether to enable virtualization for large diffs
}

export const EnhancedDiffRenderer: React.FC<EnhancedDiffRendererProps> = ({
  diffContent,
  filePath,
  content,
  maxHeight = 600,
  lineHeight = 24,
  enableVirtualization = true,
}) => {
  const [highlightCache, setHighlightCache] = useState<Map<number, string>>(new Map());
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 });
  const containerRef = useRef<HTMLDivElement>(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout>();
  const lastScrollTopRef = useRef<number>(0);
  const scrollThrottleRef = useRef<number>();

  // Re-enabling theme application to confirm this breaks re-rendering
  useEffect(() => {
    applyTheme();
    const cleanup = watchThemeChanges();
    return cleanup;
  }, []);

  // Parse diff into structured lines
  const parsedLines = useMemo(() => {
    if (!diffContent) {
      return [];
    }

    const lines = diffContent.split("\n");
    const parsed: DiffLine[] = [];

    lines.forEach((line, index) => {
      let type: DiffLine["type"] = "context";
      let lineNumber = "";
      let content = line;

      if (line.startsWith("+")) {
        type = "addition";
        lineNumber = "  +";
        content = line.substring(1);
      } else if (line.startsWith("-")) {
        type = "deletion";
        lineNumber = "  -";
        content = line.substring(1);
      } else if (
        line.startsWith("@@") ||
        line.startsWith("diff ") ||
        line.startsWith("index ") ||
        line.startsWith("--- ") ||
        line.startsWith("+++ ")
      ) {
        type = "meta";
        lineNumber = "  ";
        content = line;
      } else if (line.match(/^\d+$/)) {
        type = "meta";
        lineNumber = line.padStart(3);
        content = "";
      } else if (line.startsWith(" ")) {
        type = "context";
        lineNumber = "   ";
        content = line.substring(1);
      }

      parsed.push({
        type,
        content,
        lineNumber,
        originalIndex: index,
      });
    });

    return parsed;
  }, [diffContent]);

  // Language detection
  const detectedLanguage = useMemo(() => {
    return detectLanguage(filePath, content);
  }, [filePath, content]);

  const shouldHighlight = useMemo(() => {
    return isLanguageSupported(detectedLanguage) && detectedLanguage !== "plaintext";
  }, [detectedLanguage]);

  // Lazy syntax highlighting with caching
  const getHighlightedContent = useCallback(
    (line: DiffLine): string => {
      const cacheKey = line.originalIndex;

      // Return cached result if available
      if (highlightCache.has(cacheKey)) {
        return highlightCache.get(cacheKey)!;
      }

      // Don't highlight meta lines or empty content
      if (line.type === "meta" || !line.content.trim() || !shouldHighlight) {
        return line.content;
      }

      try {
        const highlighted = hljs.highlight(line.content, {
          language: detectedLanguage,
          ignoreIllegals: true,
        });

        const result = highlighted.value;

        // Cache the result
        setHighlightCache((cache) => new Map(cache).set(cacheKey, result));

        return result;
      } catch (error) {
        // Fallback with auto-detection
        try {
          const autoHighlighted = hljs.highlightAuto(line.content);
          if (autoHighlighted.relevance > 5) {
            const result = autoHighlighted.value;
            setHighlightCache((cache) => new Map(cache).set(cacheKey, result));
            return result;
          }
        } catch {
          // Final fallback
        }

        return line.content;
      }
    },
    [detectedLanguage, shouldHighlight, highlightCache],
  );

  // Virtualization logic
  const shouldVirtualize = enableVirtualization && parsedLines.length > 100;
  const totalHeight = parsedLines.length * lineHeight;
  const visibleCount = Math.ceil(maxHeight / lineHeight);

  // Ensure visible range is valid
  const validVisibleRange = useMemo(() => {
    if (!shouldVirtualize) {
      return { start: 0, end: parsedLines.length };
    }
    
    const start = Math.max(0, Math.min(visibleRange.start, parsedLines.length - 1));
    const end = Math.max(start + 1, Math.min(visibleRange.end, parsedLines.length));
    
    return { start, end };
  }, [shouldVirtualize, visibleRange, parsedLines.length]);

  // Throttled scroll handler to prevent excessive updates
  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (!shouldVirtualize) {
        return;
      }

      const scrollTop = event.currentTarget.scrollTop;
      
      // Skip if scroll position hasn't changed significantly
      if (Math.abs(scrollTop - lastScrollTopRef.current) < lineHeight / 2) {
        return;
      }
      
      lastScrollTopRef.current = scrollTop;
      
      // Throttle scroll updates to prevent excessive re-renders
      if (scrollThrottleRef.current) {
        return;
      }

      scrollThrottleRef.current = requestAnimationFrame(() => {
        const start = Math.floor(scrollTop / lineHeight);
        const end = Math.min(start + visibleCount + 20, parsedLines.length); // Increased buffer

        // Only update if the range has changed significantly
        const currentStart = visibleRange.start;
        const currentEnd = visibleRange.end;
        
        if (Math.abs(start - currentStart) > 5 || Math.abs(end - currentEnd) > 5) {
          setVisibleRange({ start: Math.max(0, start - 10), end }); // Increased buffer
        }

        setIsScrolling(true);
        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current);
        }
        scrollTimeoutRef.current = setTimeout(() => {
          setIsScrolling(false);
        }, 100); // Reduced timeout

        scrollThrottleRef.current = undefined;
      });
    },
    [shouldVirtualize, lineHeight, visibleCount, parsedLines.length], // Removed visibleRange from dependencies
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scrollThrottleRef.current) {
        cancelAnimationFrame(scrollThrottleRef.current);
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  // Get visible lines for rendering
  const visibleLines = shouldVirtualize
    ? parsedLines.slice(validVisibleRange.start, validVisibleRange.end)
    : parsedLines;

  // Calculate offset for virtualization
  const offsetY = shouldVirtualize ? validVisibleRange.start * lineHeight : 0;

  // Debug virtualization state
  useEffect(() => {
    if (process.env.NODE_ENV === "development" && shouldVirtualize) {
      console.log("Virtualization state:", {
        totalLines: parsedLines.length,
        visibleRange,
        validVisibleRange,
        visibleLines: visibleLines.length,
        offsetY,
        totalHeight,
        maxHeight,
        lineHeight
      });
    }
  }, [shouldVirtualize, visibleRange, validVisibleRange, visibleLines.length, offsetY, totalHeight, maxHeight, lineHeight, parsedLines.length]);

  // Render a single diff line
  const renderLine = useCallback(
    (line: DiffLine, index: number) => {
      const actualIndex = shouldVirtualize ? validVisibleRange.start + index : index;
      // Always use highlighted content to prevent layout shifts
      const highlightedContent = getHighlightedContent(line);

      return (
        <div
          key={actualIndex}
          className={`diff-line ${line.type}`}
          style={shouldVirtualize ? { height: lineHeight } : undefined}
        >
          <span className="diff-line-number">{line.lineNumber}</span>
          <span className="diff-content" dangerouslySetInnerHTML={{ __html: highlightedContent }} />
        </div>
      );
    },
    [shouldVirtualize, validVisibleRange.start, lineHeight, getHighlightedContent],
  );

  // Performance monitoring
  const renderTime = useMemo(() => {
    const start = performance.now();
    const result = visibleLines.length;
    const end = performance.now();

    if (process.env.NODE_ENV === "development") {
      console.log(`Rendered ${result} lines in ${(end - start).toFixed(2)}ms`);
    }

    return end - start;
  }, [visibleLines.length]);

  return (
    <div className="enhanced-diff-renderer">
      {/* Performance info (development only) */}
      {process.env.NODE_ENV === "development" && (
        <div
          className="diff-performance-info"
          style={{ fontSize: "12px", color: "#888", padding: "4px 8px" }}
        >
          Lines: {parsedLines.length} | Visible: {visibleLines.length} | Language:{" "}
          {detectedLanguage} | Virtualized: {shouldVirtualize ? "Yes" : "No"} | Render:{" "}
          {renderTime.toFixed(2)}ms
        </div>
      )}

      <div
        ref={containerRef}
        className="diff-container"
        style={{
          maxHeight: shouldVirtualize ? maxHeight : undefined,
          overflowY: shouldVirtualize ? "auto" : "visible",
          position: "relative",
        }}
        onScroll={handleScroll}
      >
        {shouldVirtualize && (
          <div 
            style={{ 
              height: totalHeight, 
              position: "relative",
              width: "100%"
            }}
          >
            <div
              style={{
                transform: `translateY(${offsetY}px)`,
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                width: "100%",
              }}
            >
              {visibleLines.map(renderLine)}
            </div>
          </div>
        )}

        {!shouldVirtualize && visibleLines.map(renderLine)}

        {/* Loading indicator when scrolling */}
        {isScrolling && shouldVirtualize && (
          <div
            className="diff-scroll-indicator"
            style={{
              position: "absolute",
              top: "10px",
              right: "10px",
              background: "rgba(0,0,0,0.7)",
              color: "white",
              padding: "4px 8px",
              borderRadius: "4px",
              fontSize: "12px",
              zIndex: 10,
            }}
          >
            Scrolling...
          </div>
        )}
      </div>

      {/* Language and line count info */}
      <div
        className="diff-info"
        style={{
          fontSize: "12px",
          color: "var(--pf-global--Color--200)",
          padding: "4px 8px",
          borderTop: "1px solid var(--pf-global--BorderColor--100)",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>Language: {detectedLanguage}</span>
        <span>{parsedLines.length} lines</span>
      </div>
    </div>
  );
};

export default EnhancedDiffRenderer;
