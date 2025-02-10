import "./message.css";
import React from "react";
import {
  Avatar,
  AvatarProps,
  Label,
  LabelGroupProps,
  Timestamp,
  Truncate,
} from "@patternfly/react-core";
import {
  ActionProps,
  SourcesCardProps,
  QuickResponse,
  SourcesCard,
  ResponseActions,
  FileDetailsLabel,
} from "@patternfly/chatbot";

// You can remove these interfaces if you don't need them in your codebase.
export interface MessageAttachment {
  /** Name of file attached to the message */
  name: string;
  /** Unique identifier of file attached to the message */
  id?: string | number;
  /** Callback for when attachment label is clicked */
  onClick?: (event: React.MouseEvent, name: string, id?: string | number) => void;
  /** Callback for when attachment label is closed */
  onClose?: (event: React.MouseEvent, name: string, id?: string | number) => void;
  /** Whether file is loading */
  isLoading?: boolean;
  /** Aria label for attachment close button */
  closeButtonAriaLabel?: string;
  /** Custom test id for the language in the attachment component */
  languageTestId?: string;
  /** Custom test id for the loading spinner in the attachment component */
  spinnerTestId?: string;
}

export interface MessageProps extends Omit<React.HTMLProps<HTMLDivElement>, "role" | "content"> {
  /** Unique id for message */
  id?: string;
  /** Role of the user sending the message */
  role: "user" | "bot";
  /** Message content (any ReactNode) */
  content?: React.ReactNode;
  /** Name of the user */
  name?: string;
  /** Avatar src for the user */
  avatar: string;
  /** Timestamp for the message */
  timestamp?: string;
  /** Set this to true if message is being loaded */
  isLoading?: boolean;
  /** Array of attachments attached to a message */
  attachments?: MessageAttachment[];
  /** Props for message actions, such as feedback (positive or negative), copy button, share, and listen */
  actions?: {
    [key: string]: ActionProps;
  };
  /** Sources for message (e.g., references or citations) */
  sources?: SourcesCardProps;
  /** Label for the English word "AI," used to tag messages with role "bot" */
  botWord?: string;
  /** Label for the English "Loading message," displayed to screenreaders when loading a message */
  loadingWord?: string;
  /** Props for quick responses */
  quickResponses?: QuickResponse[];
  /** Props for quick responses container */
  quickResponseContainerProps?: Omit<LabelGroupProps, "ref">;
  /** Whether avatar is round */
  hasRoundAvatar?: boolean;
  /** Any additional props applied to the avatar, for additional customization  */
  avatarProps?: Omit<AvatarProps, "alt">;
  /** Turns the container into a live region so that changes to content within the Message are announced to assistive tech */
  isLiveRegion?: boolean;
  /** Ref applied to message */
  innerRef?: React.Ref<HTMLDivElement>;
}

export const MessageBase: React.FunctionComponent<MessageProps> = ({
  role,
  content,
  name,
  avatar,
  timestamp,
  isLoading,
  actions,
  sources,
  botWord = "AI",
  loadingWord = "Loading message",
  quickResponses,
  quickResponseContainerProps = { numLabels: 5 },
  attachments,
  hasRoundAvatar = true,
  avatarProps,
  isLiveRegion = true,
  innerRef,
  ...props
}: MessageProps) => {
  let avatarClassName;
  if (avatarProps && "className" in avatarProps) {
    const { className, ...rest } = avatarProps;
    avatarClassName = className;
    avatarProps = { ...rest };
  }
  // Keep timestamps consistent between Timestamp component and aria-label
  const date = new Date();
  const dateString = timestamp ?? `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;

  return (
    <section
      aria-label={`Message from ${role} - ${dateString}`}
      className={`pf-chatbot__message pf-chatbot__message--${role}`}
      aria-live={isLiveRegion ? "polite" : undefined}
      aria-atomic={isLiveRegion ? false : undefined}
      ref={innerRef}
      {...props}
    >
      {/* We are using an empty alt tag intentionally in order to reduce noise on screen readers */}
      <Avatar
        className={`pf-chatbot__message-avatar ${
          hasRoundAvatar ? "pf-chatbot__message-avatar--round" : ""
        } ${avatarClassName ? avatarClassName : ""}`}
        src={avatar}
        alt=""
        {...avatarProps}
      />
      <div className="pf-chatbot__message-contents">
        <div className="pf-chatbot__message-meta">
          {name && (
            <span className="pf-chatbot__message-name">
              <Truncate content={name} />
            </span>
          )}
          {role === "bot" && (
            <Label variant="outline" isCompact>
              {botWord}
            </Label>
          )}
          <Timestamp date={date}>{timestamp}</Timestamp>
        </div>
        <div className="pf-chatbot__message-response">
          <div className="pf-chatbot__message-and-actions">
            {isLoading ? (
              <MessageLoading loadingWord={loadingWord} />
            ) : (
              /* Simply render any ReactNode passed to `content` */
              <>{content}</>
            )}
            {!isLoading && sources && <SourcesCard {...sources} />}
            {!isLoading && actions && <ResponseActions actions={actions} />}
          </div>
          {attachments && (
            <div className="pf-chatbot__message-attachments-container">
              {attachments.map((attachment) => (
                <div
                  key={attachment.id ?? attachment.name}
                  className="pf-chatbot__message-attachment"
                >
                  <FileDetailsLabel
                    fileName={attachment.name}
                    fileId={attachment.id}
                    onClose={attachment.onClose}
                    onClick={attachment.onClick}
                    isLoading={attachment.isLoading}
                    closeButtonAriaLabel={attachment.closeButtonAriaLabel}
                    languageTestId={attachment.languageTestId}
                    spinnerTestId={attachment.spinnerTestId}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export const Message = React.forwardRef((props: MessageProps, ref: React.Ref<HTMLDivElement>) => (
  <MessageBase innerRef={ref} {...props} />
));

/** Displays a simple loading indicator. */
export const MessageLoading = ({ loadingWord }: { loadingWord?: string }) => (
  <div className="pf-chatbot__message-loading">
    <span className="pf-chatbot__message-loading-dots">
      <span className="pf-v6-screen-reader">{loadingWord}</span>
    </span>
  </div>
);
