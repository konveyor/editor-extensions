import { useState, useEffect, useRef, type RefObject } from "react";

const DEFAULT_MIN_WIDTH = 350;

/**
 * Monitors the width of a container element via ResizeObserver and reports
 * whether the container is narrower than the given minimum.
 */
export function useContainerWidth(minWidth = DEFAULT_MIN_WIDTH): {
  containerRef: RefObject<HTMLDivElement>;
  isTooNarrow: boolean;
  width: number;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        setWidth(w);
      }
    });

    observer.observe(el);
    setWidth(el.clientWidth);

    return () => observer.disconnect();
  }, []);

  return { containerRef, isTooNarrow: width > 0 && width < minWidth, width };
}
