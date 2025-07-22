import { useRef, useCallback, useEffect } from "react";
import { ChatMessage, LocalChange } from "@editor-extensions/shared";
import { MessageBoxHandle } from "@patternfly/chatbot";

export const useScrollManagement = (
  chatMessages: ChatMessage[],
  isFetchingSolution: boolean,
  localChanges?: LocalChange[],
  isAgentMode?: boolean,
) => {
  const messageBoxRef = useRef<MessageBoxHandle | null>(null);
  const scrollTimeoutRef = useRef<number | null>(null);
  const lastScrollTime = useRef<number>(0);
  const userHasScrolledUp = useRef(false);
  const lastUserScrollTime = useRef<number>(0);
  const isHandlingLayoutChange = useRef(false); // Track if we're handling layout changes
  const lastContentHeight = useRef<number>(0); // Track content height changes
  const lastLocalChangesCount = useRef<number>(0); // Track local changes count

  const getMessageBoxElement = useCallback(() => {
    const selectors = [
      ".pf-chatbot__messagebox",
      ".pf-chatbot__content",
      ".pf-chatbot-container",
      ".pf-chatbot",
    ];

    // Helper function to check if an element is scrollable
    const isScrollable = (element: Element): boolean => {
      try {
        const { scrollHeight, clientHeight } = element;
        const computedStyle = window.getComputedStyle(element);
        const overflowY = computedStyle.overflowY;

        // Element must have content that exceeds its visible height
        // and have overflow properties that allow scrolling
        return (
          scrollHeight > clientHeight &&
          (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay")
        );
      } catch (error) {
        console.warn(`Error checking scrollability for element:`, error);
        return false;
      }
    };

    // Helper function to validate if element is likely a message container
    const isValidMessageContainer = (element: Element): boolean => {
      try {
        // Check for expected container characteristics
        const hasMessages = element.querySelector(
          '[class*="message"], [class*="chat"], .pf-chatbot__message',
        );
        const hasMinHeight = element.clientHeight > 50; // Reasonable minimum height
        const isVisible = window.getComputedStyle(element).display !== "none";

        return Boolean(hasMessages || hasMinHeight) && isVisible;
      } catch (error) {
        console.warn(`Error validating message container:`, error);
        return false;
      }
    };

    // Search for the best scrollable message container
    for (const selector of selectors) {
      try {
        const element = document.querySelector(selector);
        if (element && isValidMessageContainer(element) && isScrollable(element)) {
          return element;
        }
      } catch (error) {
        console.warn(`Error querying selector "${selector}":`, error);
        continue;
      }
    }

    // If no scrollable container found, try to find any valid container
    // but still ensure it has the potential to be scrollable
    for (const selector of selectors) {
      try {
        const element = document.querySelector(selector);
        if (element && isValidMessageContainer(element)) {
          // Even if not currently scrollable, it might become scrollable with content
          return element;
        }
      } catch (error) {
        console.warn(`Error in fallback query for selector "${selector}":`, error);
        continue;
      }
    }

    console.warn("No suitable message container found with any of the selectors:", selectors);
    return null;
  }, []);

  const isNearBottom = useCallback(() => {
    const messageBox = getMessageBoxElement();
    if (!messageBox) {
      return false;
    }

    try {
      const { scrollTop, scrollHeight, clientHeight } = messageBox;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      return distanceFromBottom < 50;
    } catch (error) {
      console.warn("Error checking if near bottom:", error);
      return false;
    }
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
          try {
            isHandlingLayoutChange.current = true; // Mark that we're causing a scroll
            messageBox.scrollTop = messageBox.scrollHeight;
            lastScrollTime.current = Date.now();
            userHasScrolledUp.current = false;
            // Reset flag after a delay to allow for scroll event processing
            setTimeout(() => {
              isHandlingLayoutChange.current = false;
            }, 100);
          } catch (error) {
            console.warn("Error performing scroll to bottom:", error);
            isHandlingLayoutChange.current = false;
          }
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

  // Enhanced auto-scroll for new messages with layout change detection
  useEffect(() => {
    if (Array.isArray(chatMessages) && chatMessages?.length > 0) {
      const now = Date.now();
      const noRecentUserScroll = now - lastUserScrollTime.current > 1000;

      // Check for content height changes (indicates layout changes from components)
      const messageBox = getMessageBoxElement();
      if (messageBox) {
        const currentHeight = messageBox.scrollHeight;
        const heightChanged = Math.abs(currentHeight - lastContentHeight.current) > 10;
        lastContentHeight.current = currentHeight;

        // Auto-scroll if conditions are met OR if content height changed significantly
        if (!userHasScrolledUp.current && (isNearBottom() || noRecentUserScroll || heightChanged)) {
          // Add longer delay for complex components to finish rendering
          const delay = heightChanged ? 200 : 100;
          setTimeout(() => scrollToBottom(false), delay);
        }
      }
    }
  }, [chatMessages, scrollToBottom, isNearBottom, getMessageBoxElement]);

  // Handle local changes updates (for non-agent mode)
  useEffect(() => {
    if (!isAgentMode && Array.isArray(localChanges)) {
      const currentChangesCount = localChanges.length;
      const changesCountChanged = currentChangesCount !== lastLocalChangesCount.current;

      if (changesCountChanged) {
        lastLocalChangesCount.current = currentChangesCount;

        // Auto-scroll when local changes are added/removed in non-agent mode
        if (!userHasScrolledUp.current) {
          setTimeout(() => scrollToBottom(false), 150);
        }
      }
    }
  }, [localChanges, isAgentMode, scrollToBottom]);

  // Set up scroll listener with better layout change detection
  useEffect(() => {
    const messageBox = getMessageBoxElement();
    if (!messageBox) {
      return;
    }

    const handleScroll = () => {
      try {
        // Ignore scroll events that we caused programmatically
        if (isHandlingLayoutChange.current) {
          return;
        }

        // If user scrolls to near bottom, reset the "scrolled up" flag
        if (isNearBottom()) {
          userHasScrolledUp.current = false;
        } else {
          // Only set "scrolled up" flag if user has scrolled significantly away from bottom
          const now = Date.now();
          if (now - lastScrollTime.current > 50) {
            const messageBox = getMessageBoxElement();
            if (messageBox) {
              const { scrollTop, scrollHeight, clientHeight } = messageBox;
              const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
              // Only consider it "scrolled up" if they're more than 100px from bottom
              // AND it's been enough time since our last programmatic scroll
              if (distanceFromBottom > 100 && now - lastScrollTime.current > 200) {
                userHasScrolledUp.current = true;
                lastUserScrollTime.current = now;
              }
            }
          }
        }
      } catch (error) {
        console.warn("Error handling scroll event:", error);
      }
    };

    try {
      messageBox.addEventListener("scroll", handleScroll, { passive: true });
      return () => {
        try {
          messageBox.removeEventListener("scroll", handleScroll);
        } catch (error) {
          console.warn("Error removing scroll event listener:", error);
        }
      };
    } catch (error) {
      console.warn("Error setting up scroll event listener:", error);
    }
  }, [getMessageBoxElement, isNearBottom]);

  // Enhanced periodic scrolling for fetching state
  useEffect(() => {
    if (isFetchingSolution) {
      const interval = setInterval(() => {
        const now = Date.now();
        const noRecentUserScroll = now - lastUserScrollTime.current > 2000;

        // Be more aggressive about scrolling during content fetching
        if (!userHasScrolledUp.current && (isNearBottom() || noRecentUserScroll)) {
          scrollToBottom(false);
        }
      }, 1000); // More frequent updates during fetching

      return () => clearInterval(interval);
    }
  }, [isFetchingSolution, scrollToBottom, isNearBottom]);

  // Cleanup timeout on component unmount to prevent memory leaks
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
    }, 150); // Small delay to ensure DOM updates are complete

    return () => clearTimeout(timeoutId);
  }, [scrollToBottom]);

  return { messageBoxRef, triggerScrollOnUserAction };
};
