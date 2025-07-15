import { useRef, useCallback, useEffect } from "react";
import { ChatMessage } from "@editor-extensions/shared";
import { MessageBoxHandle } from "@patternfly/chatbot";

export const useScrollManagement = (chatMessages: ChatMessage[], isFetchingSolution: boolean) => {
  const messageBoxRef = useRef<MessageBoxHandle>(null);
  const scrollTimeoutRef = useRef<number | null>(null);
  const lastScrollTime = useRef<number>(0);
  const userHasScrolledUp = useRef(false);

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
            messageBox.scrollTop = messageBox.scrollHeight;
            lastScrollTime.current = Date.now();
            userHasScrolledUp.current = false;
          } catch (error) {
            console.warn("Error performing scroll to bottom:", error);
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

  // Handle new messages and content updates
  useEffect(() => {
    if (Array.isArray(chatMessages) && chatMessages?.length > 0) {
      // Only auto-scroll if user hasn't manually scrolled up
      if (!userHasScrolledUp.current) {
        setTimeout(() => scrollToBottom(false), 100);
      }
    }
  }, [chatMessages, scrollToBottom]);

  // Set up scroll listener to track when user manually scrolls
  useEffect(() => {
    const messageBox = getMessageBoxElement();
    if (!messageBox) {
      return;
    }

    const handleScroll = () => {
      try {
        // If user scrolls to near bottom, reset the "scrolled up" flag
        if (isNearBottom()) {
          userHasScrolledUp.current = false;
        } else {
          // Only set "scrolled up" flag if the scroll wasn't triggered by our auto-scroll
          const now = Date.now();
          if (now - lastScrollTime.current > 100) {
            userHasScrolledUp.current = true;
          }
        }
      } catch (error) {
        console.warn("Error handling scroll event:", error);
      }
    };

    try {
      messageBox.addEventListener("scroll", handleScroll);
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

  // Reduced frequency and more conditional scrolling while content is being updated
  useEffect(() => {
    if (isFetchingSolution) {
      const interval = setInterval(() => {
        // Only auto-scroll if user hasn't manually scrolled up and we're still near bottom
        if (!userHasScrolledUp.current && isNearBottom()) {
          scrollToBottom(false);
        }
      }, 1000); // Reduced frequency from 500ms to 1000ms

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

  return { messageBoxRef, scrollToBottom };
};
