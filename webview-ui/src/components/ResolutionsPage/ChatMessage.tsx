import React from "react";
import { ChatMessageType, ChatMessage as ChatMessage_ } from "@editor-extensions/shared";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { prettyPrintJson } from "pretty-print-json";

interface RenderMessageProps {
  value: ChatMessage_["value"];
}

const StringRender: React.FC<RenderMessageProps> = ({ value }) => {
  return <div>{value.message as string}</div>;
};

const MarkdownRender: React.FC<RenderMessageProps> = ({ value }) => {
  return (
    <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
      {value.message as string}
    </Markdown>
  );
};

const JsonRender: React.FC<RenderMessageProps> = ({ value }) => {
  const jsonAsHtml = prettyPrintJson.toHtml(value, {
    indent: 2,
    lineNumbers: false,
    linkUrls: false,
    quoteKeys: false,
    trailingCommas: false,
  });
  return <Markdown rehypePlugins={[rehypeRaw]}>{jsonAsHtml}</Markdown>;
};

const RENDER_MAPPING = {
  [ChatMessageType.String]: StringRender,
  [ChatMessageType.Markdown]: MarkdownRender,
  [ChatMessageType.JSON]: JsonRender,
  default: StringRender,
};

interface ChatMessageProps {
  message: ChatMessage_;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const Render = RENDER_MAPPING[message.kind] ?? RENDER_MAPPING.default;

  return (
    <div className="chat-message">
      <Render value={message.value} />
    </div>
  );
};
