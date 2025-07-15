import React from "react";
import "./MessageWrapper.css";

interface MessageWrapperProps {
  children: React.ReactNode;
  className?: string;
}

export const MessageWrapper: React.FC<MessageWrapperProps> = ({ children, className = "" }) => {
  return <div className={`message-wrapper ${className}`}>{children}</div>;
};
