import { useState, useEffect } from "react";

export interface ChatMessage {
  id: string;
  name: string;
  role: "bot" | "user";
  content: string;
  avatar: string;
  timestamp: number;
}

export const useChatMessages = () => {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const savedMessages = localStorage.getItem("chatMessages");
    return savedMessages ? JSON.parse(savedMessages) : [];
  });

  useEffect(() => {
    localStorage.setItem("chatMessages", JSON.stringify(messages));
  }, [messages]);

  const addMessage = (message: Omit<ChatMessage, "id" | "timestamp">) => {
    const newMessage = {
      ...message,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, newMessage]);
  };

  const clearMessages = () => {
    setMessages([]);
  };

  return {
    messages,
    addMessage,
    clearMessages,
  };
};
