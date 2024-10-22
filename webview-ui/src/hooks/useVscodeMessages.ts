import { useEffect } from "react";

interface MessageHandler {
  (message: any): void;
}

export function useVscodeMessages(messageHandler: MessageHandler) {
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      messageHandler(message);
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [messageHandler]);
}
