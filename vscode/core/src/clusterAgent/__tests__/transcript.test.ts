import expect from "expect";
import { ClusterRunTranscript, answerChoices, answerField } from "../transcript";

function harness() {
  const draft = { chatMessages: [] as any[] };
  const transcript = new ClusterRunTranscript(
    { mutate: (recipe) => recipe(draft as any) },
    "ide-1",
  );
  return { draft, transcript };
}

describe("ClusterRunTranscript", () => {
  it("joins streamed text into one message until something else happens", () => {
    const { draft, transcript } = harness();
    transcript.apply({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Hel" },
    });
    transcript.apply({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "lo" },
    });
    transcript.apply({
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      title: "edit",
      rawInput: { path: "/w/A.java" },
    });
    transcript.apply({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Done" },
    });
    expect(draft.chatMessages.map((m) => m.value.message ?? m.value.toolName)).toEqual([
      "Hello",
      "edit",
      "Done",
    ]);
    expect(draft.chatMessages[1].value.filePath).toBe("/w/A.java");
  });

  it("updates a tool call's status and result in place", () => {
    const { draft, transcript } = harness();
    transcript.apply({ sessionUpdate: "tool_call", toolCallId: "t1", title: "shell" });
    transcript.apply({
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "BUILD SUCCESS" } }],
    });
    expect(draft.chatMessages).toHaveLength(1);
    expect(draft.chatMessages[0].value).toMatchObject({
      toolName: "shell",
      toolStatus: "succeeded",
      toolResult: "BUILD SUCCESS",
    });
  });

  it("ignores the harness's prompt and other update kinds", () => {
    const { draft, transcript } = harness();
    transcript.apply({
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "prompt" },
    });
    transcript.apply({ sessionUpdate: "usage_update", used: 1 });
    expect(draft.chatMessages).toEqual([]);
  });

  it("marks tool calls still running as failed when the run ends", () => {
    const { draft, transcript } = harness();
    transcript.apply({ sessionUpdate: "tool_call", toolCallId: "t1", title: "edit" });
    transcript.finishTools();
    expect(draft.chatMessages[0].value.toolStatus).toBe("failed");
  });
});

describe("question helpers", () => {
  it("answers ask_user's single string field", () => {
    const ask = {
      askId: "kask-1",
      message: "Which?",
      requestedSchema: { properties: { answer: { type: "string" } } },
    };
    expect(answerField(ask)).toBe("answer");
    expect(answerChoices(ask)).toEqual([]);
  });

  it("offers the enum as choices", () => {
    const ask = {
      askId: "kask-2",
      message: "Pick",
      requestedSchema: { properties: { answer: { type: "string", enum: ["a", "b"] } } },
    };
    expect(answerChoices(ask)).toEqual(["a", "b"]);
  });

  it("defaults to `answer` without a schema", () => {
    expect(answerField({ askId: 1, message: "?" })).toBe("answer");
  });
});
