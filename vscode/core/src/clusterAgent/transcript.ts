/**
 * Writing a cluster AgentRun's ACP stream into the chat transcript, plus the
 * helpers for answering its questions. Kept free of vscode and command-layer
 * imports so it can be unit tested.
 */
import {
  ChatMessageType,
  type ExtensionData,
  type ToolMessageValue,
} from "@editor-extensions/shared";
import { getToolFilePath } from "../features/agent/fileTracker";
import type { ElicitationAsk, RunUpdate } from "./hubAcpViewer";

/** The form field to answer (ask_user sends one string field, `answer`). */
export function answerField(ask: ElicitationAsk): string {
  const keys = Object.keys(ask.requestedSchema?.properties ?? {});
  return keys[0] ?? "answer";
}

/** Choices offered for the answer field, if the question is multiple choice. */
export function answerChoices(ask: ElicitationAsk): string[] {
  return ask.requestedSchema?.properties?.[answerField(ask)]?.enum ?? [];
}

/**
 * Writes a cluster run's stream into the chat transcript, the same way the
 * Get Solution orchestrator writes a local run's.
 */
export class ClusterRunTranscript {
  private textToken: string | null = null;
  private counter = 0;

  constructor(
    private readonly state: { mutate(recipe: (draft: ExtensionData) => void): unknown },
    private readonly runName: string,
  ) {}

  private token(kind: string): string {
    return `cluster-${this.runName}-${kind}-${++this.counter}`;
  }

  /** A standalone message (run start/end, questions). */
  note(message: string): void {
    this.textToken = null;
    this.state.mutate((draft) => {
      draft.chatMessages.push({
        kind: ChatMessageType.String,
        messageToken: this.token("note"),
        timestamp: new Date().toISOString(),
        value: { message },
      });
    });
  }

  /** End the current text block, so the next chunk starts a new message. */
  breakText(): void {
    this.textToken = null;
  }

  apply(update: RunUpdate): void {
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        this.appendText(contentText(update.content));
        break;
      case "agent_thought_chunk": {
        const text = contentText(update.content);
        this.appendText(text ? `> ${text}\n` : "");
        break;
      }
      case "tool_call":
        this.toolCall(update);
        break;
      case "tool_call_update":
        this.toolCallUpdate(update);
        break;
      default:
        // user_message_chunk (the harness's prompt), usage, plans, …
        break;
    }
  }

  /** Mark tool calls still shown as running as ended (the run is over). */
  finishTools(): void {
    this.state.mutate((draft) => {
      for (const msg of draft.chatMessages) {
        if (
          msg.kind === ChatMessageType.Tool &&
          msg.messageToken.startsWith(`cluster-${this.runName}-tool-`) &&
          (msg.value as ToolMessageValue).toolStatus === "running"
        ) {
          (msg.value as ToolMessageValue).toolStatus = "failed";
        }
      }
    });
  }

  private appendText(text: string): void {
    if (!text) {
      return;
    }
    if (!this.textToken) {
      const token = this.token("text");
      this.textToken = token;
      this.state.mutate((draft) => {
        draft.chatMessages.push({
          kind: ChatMessageType.String,
          messageToken: token,
          timestamp: new Date().toISOString(),
          value: { message: text },
        });
      });
      return;
    }
    const token = this.textToken;
    this.state.mutate((draft) => {
      for (let i = draft.chatMessages.length - 1; i >= 0; i--) {
        const msg = draft.chatMessages[i];
        if (msg.messageToken === token && msg.kind === ChatMessageType.String) {
          msg.value.message += text;
          msg.timestamp = new Date().toISOString();
          return;
        }
      }
    });
  }

  private toolToken(toolCallId: unknown): string {
    return `cluster-${this.runName}-tool-${String(toolCallId)}`;
  }

  private toolCall(update: RunUpdate): void {
    this.textToken = null;
    const args = asRecord(update.rawInput);
    const filePath = getToolFilePath(args);
    this.state.mutate((draft) => {
      draft.chatMessages.push({
        kind: ChatMessageType.Tool,
        messageToken: this.toolToken(update.toolCallId),
        timestamp: new Date().toISOString(),
        value: {
          toolName: typeof update.title === "string" && update.title ? update.title : "Tool call",
          toolStatus: "running",
          filePath,
        } as ToolMessageValue,
      });
    });
  }

  private toolCallUpdate(update: RunUpdate): void {
    const token = this.toolToken(update.toolCallId);
    const status =
      update.status === "completed"
        ? "succeeded"
        : update.status === "failed"
          ? "failed"
          : "running";
    const result = toolResultText(update.content);
    const filePath = getToolFilePath(asRecord(update.rawInput));
    this.state.mutate((draft) => {
      for (let i = draft.chatMessages.length - 1; i >= 0; i--) {
        const msg = draft.chatMessages[i];
        if (msg.messageToken === token && msg.kind === ChatMessageType.Tool) {
          const prev = msg.value as ToolMessageValue;
          msg.value = {
            ...prev,
            toolName:
              typeof update.title === "string" && update.title ? update.title : prev.toolName,
            toolStatus: status,
            toolResult: result ?? prev.toolResult,
            filePath: prev.filePath ?? filePath,
          } as ToolMessageValue;
          msg.timestamp = new Date().toISOString();
          return;
        }
      }
    });
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function contentText(content: unknown): string {
  const c = asRecord(content);
  return c && c.type === "text" && typeof c.text === "string" ? c.text : "";
}

function toolResultText(content: unknown): string | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }
  for (const item of content) {
    const entry = asRecord(item);
    if (entry?.type === "content") {
      const text = contentText(entry.content);
      if (text) {
        return text;
      }
    }
  }
  return undefined;
}
