import { useEffect } from "react";

export function useAutoScrollToBottom(
  bottomRef: React.RefObject<HTMLElement>,
  isUserScrollingRef: React.MutableRefObject<boolean>,
  deps: any[] = [],
) {
  useEffect(() => {
    const container = findScrollContainer(bottomRef.current);
    if (!container) {
      return;
    }

    const scrollToBottom = () => {
      if (!isUserScrollingRef.current) {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    };

    // Trigger on new messages or changing content
    scrollToBottom();

    // Observe for dynamic height changes
    const observer = new ResizeObserver(scrollToBottom);
    if (bottomRef.current) {
      observer.observe(bottomRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, deps);
}
function findScrollContainer(el: HTMLElement | null): HTMLElement | null {
  let node = el;
  while (node && node !== document.body) {
    const hasScroll = node.scrollHeight > node.clientHeight;
    const overflowY = window.getComputedStyle(node).overflowY;
    if (hasScroll && (overflowY === "auto" || overflowY === "scroll")) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}
