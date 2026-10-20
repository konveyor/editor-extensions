import expect from "expect";
import { ChatMessageType, type ChatMessage } from "@editor-extensions/shared";
import { upsertModifiedFileMessage } from "../chatFileMessages";

function fileValue(path: string, content: string) {
  return { path, content, isNew: false, diff: `+${content}` };
}

describe("upsertModifiedFileMessage", () => {
  it("adds a message for a file routed for the first time", () => {
    const messages: ChatMessage[] = [];
    const token = upsertModifiedFileMessage(messages, fileValue("A.java", "v1"), "t1", "ts1");
    expect(token).toBe("t1");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      kind: ChatMessageType.ModifiedFile,
      messageToken: "t1",
      value: { path: "A.java", content: "v1" },
    });
  });

  it("updates the undecided message when the same file is edited again", () => {
    const messages: ChatMessage[] = [
      {
        kind: ChatMessageType.String,
        messageToken: "s",
        timestamp: "ts0",
        value: { message: "hi" },
      },
    ];
    upsertModifiedFileMessage(messages, fileValue("A.java", "v1"), "t1", "ts1");
    upsertModifiedFileMessage(messages, fileValue("B.java", "b1"), "t2", "ts2");
    const token = upsertModifiedFileMessage(messages, fileValue("A.java", "v2"), "t3", "ts3");

    expect(token).toBe("t1");
    expect(messages.map((m) => m.messageToken)).toEqual(["s", "t1", "t2"]);
    expect(messages[1].value).toMatchObject({ path: "A.java", content: "v2", diff: "+v2" });
    expect(messages[1].timestamp).toBe("ts3");
  });

  it("adds a new message once the earlier one has been acted on", () => {
    const messages: ChatMessage[] = [];
    upsertModifiedFileMessage(messages, fileValue("A.java", "v1"), "t1", "ts1");
    (messages[0].value as { status?: string }).status = "applied";

    const token = upsertModifiedFileMessage(messages, fileValue("A.java", "v2"), "t2", "ts2");
    expect(token).toBe("t2");
    expect(messages).toHaveLength(2);
    expect(messages[0].value).toMatchObject({ content: "v1", status: "applied" });
    expect(messages[1].value).toMatchObject({ content: "v2" });
  });
});
