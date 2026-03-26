import { useRef, useCallback, useEffect } from "react";
import { ChatMessage } from "@editor-extensions/shared";
import { MessageBoxHandle } from "@patternfly/chatbot";

const NEAR_BOTTOM_THRESHOLD = 150;
const USER_SCROLLED_UP_THRESHOLD = 200;
const STREAMING_POLL_MS = 250;

export const useScrollManagement = (chatMessages: ChatMessage[], isFetchingSolution: boolean) => {
  const messageBoxRef = useRef<MessageBoxHandle | null>(null);
  const scrollTimeoutRef = useRef<number | null>(null);
  const lastScrollTime = useRef<number>(0);
  const userHasScrolledUp = useRef(false);
  const lastUserScrollTime = useRef<number>(0);
  const isHandlingLayoutChange = useRef(false);
  const lastContentHeight = useRef<number>(0);

  const getMessageBoxElement = useCallback(() => {
    const selectors = [
      ".pf-chatbot__messagebox",
      ".pf-chatbot__content",
      ".pf-chatbot-container",
      ".pf-chatbot",
    ];

    const isScrollable = (element: Element): boolean => {
      const { scrollHeight, clientHeight } = element;
      const computedStyle = window.getComputedStyle(element);
      const overflowY = computedStyle.overflowY;
      return (
        scrollHeight > clientHeight &&
        (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay")
      );
    };

    const isValidMessageContainer = (element: Element): boolean => {
      const hasMessages = element.querySelector(
        '[class*="message"], [class*="chat"], .pf-chatbot__message',
      );
      const hasMinHeight = element.clientHeight > 50;
      const isVisible = window.getComputedStyle(element).display !== "none";
      return Boolean(hasMessages || hasMinHeight) && isVisible;
    };

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && isValidMessageContainer(element) && isScrollable(element)) {
        return element;
      }
    }

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && isValidMessageContainer(element)) {
        return element;
      }
    }

    return null;
  }, []);

  const isNearBottom = useCallback(() => {
    const messageBox = getMessageBoxElement();
    if (!messageBox) {
      return false;
    }
    const { scrollTop, scrollHeight, clientHeight } = messageBox;
    return scrollHeight - scrollTop - clientHeight < NEAR_BOTTOM_THRESHOLD;
  }, [getMessageBoxElement]);

  const scrollToBottom = useCallback(
    (force = false) => {
      const messageBox = getMessageBoxElement();
      if (!messageBox) {
        return;
      }

      if (scrollTimeoutRef.current) {
        window.clearTimeout(scrollTimeoutRef.current);
      }

      if (force || !userHasScrolledUp.current) {
        const now = Date.now();

        const performScroll = () => {
          isHandlingLayoutChange.current = true;
          messageBox.scrollTop = messageBox.scrollHeight;
          lastScrollTime.current = Date.now();
          userHasScrolledUp.current = false;
          setTimeout(() => {
            isHandlingLayoutChange.current = false;
          }, 100);
        };

        if (now - lastScrollTime.current < 50) {
          scrollTimeoutRef.current = window.setTimeout(performScroll, 50);
        } else {
          performScroll();
          lastScrollTime.current = now;
        }
      }
    },
    [getMessageBoxElement],
  );

  // Auto-scroll when chatMessages array changes (new message or streaming update)
  useEffect(() => {
    if (!Array.isArray(chatMessages) || chatMessages.length === 0) {
      return;
    }
    const messageBox = getMessageBoxElement();
    if (!messageBox) {
      return;
    }

    const currentHeight = messageBox.scrollHeight;
    const heightChanged = Math.abs(currentHeight - lastContentHeight.current) > 5;
    lastContentHeight.current = currentHeight;

    if (!userHasScrolledUp.current && (isNearBottom() || heightChanged)) {
      setTimeout(() => scrollToBottom(false), 50);
    }
  }, [chatMessages, scrollToBottom, isNearBottom, getMessageBoxElement]);

  // ResizeObserver: auto-scroll when the message container's content height
  // grows (catches markdown rendering, code block expansion, image loads, etc.)
  useEffect(() => {
    const messageBox = getMessageBoxElement();
    if (!messageBox) {
      return;
    }

    let rafId: number | null = null;

    const observer = new ResizeObserver(() => {
      if (rafId) {
        return;
      }
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const newHeight = messageBox.scrollHeight;
        if (newHeight > lastContentHeight.current + 5 && !userHasScrolledUp.current) {
          lastContentHeight.current = newHeight;
          scrollToBottom(false);
        }
      });
    });

    const firstChild = messageBox.firstElementChild;
    if (firstChild) {
      observer.observe(firstChild);
    }
    observer.observe(messageBox);

    return () => {
      observer.disconnect();
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [getMessageBoxElement, scrollToBottom]);

  // Scroll listener: detect intentional user scroll-up
  useEffect(() => {
    const messageBox = getMessageBoxElement();
    if (!messageBox) {
      return;
    }

    const handleScroll = () => {
      if (isHandlingLayoutChange.current) {
        return;
      }

      if (isNearBottom()) {
        userHasScrolledUp.current = false;
      } else {
        const now = Date.now();
        if (now - lastScrollTime.current > 100) {
          const { scrollTop, scrollHeight, clientHeight } = messageBox;
          const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
          if (distanceFromBottom > USER_SCROLLED_UP_THRESHOLD) {
            userHasScrolledUp.current = true;
            lastUserScrollTime.current = now;
          }
        }
      }
    };

    messageBox.addEventListener("scroll", handleScroll, { passive: true });
    return () => messageBox.removeEventListener("scroll", handleScroll);
  }, [getMessageBoxElement, isNearBottom]);

  // Fast polling during active streaming/fetching
  useEffect(() => {
    if (!isFetchingSolution) {
      return;
    }
    const interval = setInterval(() => {
      if (userHasScrolledUp.current) {
        return;
      }
      const messageBox = getMessageBoxElement();
      if (!messageBox) {
        return;
      }
      const heightGrew = messageBox.scrollHeight > lastContentHeight.current + 5;
      if (isNearBottom() || heightGrew) {
        lastContentHeight.current = messageBox.scrollHeight;
        scrollToBottom(false);
      }
    }, STREAMING_POLL_MS);

    return () => clearInterval(interval);
  }, [isFetchingSolution, scrollToBottom, isNearBottom, getMessageBoxElement]);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        window.clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
    };
  }, []);

  const triggerScrollOnUserAction = useCallback(() => {
    const timeoutId = setTimeout(() => {
      scrollToBottom(false);
    }, 150);
    return () => clearTimeout(timeoutId);
  }, [scrollToBottom]);

  return { messageBoxRef, triggerScrollOnUserAction };
};
