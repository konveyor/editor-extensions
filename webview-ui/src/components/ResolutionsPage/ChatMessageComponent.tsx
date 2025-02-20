import React from "react";
import { ChatMessageType, ChatMessage } from "@editor-extensions/shared";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";

// css for markdown and plugins
import "github-markdown-css/github-markdown.css";
import "highlight.js/styles/github.min.css";
import "./chatMessageComponent.css";

interface RenderMessageProps {
  value: ChatMessage["value"];
}

const StringRender: React.FC<RenderMessageProps> = ({ value }) => {
  return <div>{value.message as string}</div>;
};

const MarkdownRender: React.FC<RenderMessageProps> = ({ value }) => {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight, rehypeRaw, rehypeSanitize]}
    >
      {value.message as string}
    </Markdown>
  );
};

const JsonRender: React.FC<RenderMessageProps> = ({ value }) => {
  const jsonAsMarkdown = "```json\n" + JSON.stringify(value, undefined, 2) + "\n```\n";
  return <Markdown rehypePlugins={[rehypeHighlight]}>{jsonAsMarkdown}</Markdown>;
};

const RENDER_MAPPING = {
  [ChatMessageType.String]: StringRender,
  [ChatMessageType.Markdown]: MarkdownRender,
  [ChatMessageType.JSON]: JsonRender,
  default: StringRender,
};

interface ChatMessageComponentProps {
  message: ChatMessage;
}

export const ChatMessageComponent: React.FC<ChatMessageComponentProps> = ({ message }) => {
  const Render = RENDER_MAPPING[message.kind] ?? RENDER_MAPPING.default;

  return (
    <div className="chat-message">
      <Render value={message.value} />
    </div>
  );
};
