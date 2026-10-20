import { expect } from "expect";
import { useExtensionStore } from "../store/store";

describe("cancelAgentMessage (#1389 self-review)", () => {
  beforeEach(() => {
    useExtensionStore.setState({ agentMessages: [] });
  });

  it("records a cancellation for a reply that never produced output", () => {
    // The user's message was sent, then dropped (Stop, or Get Solution took
    // over) before any chunk arrived.
    useExtensionStore.setState({
      agentMessages: [{ id: "u1", role: "user", content: "fix it", timestamp: "t" }],
    });
    useExtensionStore.getState().cancelAgentMessage("r1");

    const msgs = useExtensionStore.getState().agentMessages;
    expect(msgs).toHaveLength(2);
    const last = msgs[msgs.length - 1];
    expect(last.role).toBe("assistant");
    expect(last.id).toBe("r1");
    expect(last.isCancelled).toBe(true);
    expect(last.isStreaming).toBe(false);
  });

  it("marks an existing streaming reply cancelled without adding another", () => {
    useExtensionStore.setState({
      agentMessages: [
        { id: "u1", role: "user", content: "fix it", timestamp: "t" },
        { id: "r1", role: "assistant", content: "partial", timestamp: "t", isStreaming: true },
      ],
    });
    useExtensionStore.getState().cancelAgentMessage("r1");

    const msgs = useExtensionStore.getState().agentMessages;
    expect(msgs).toHaveLength(2);
    expect(msgs[1].isCancelled).toBe(true);
    expect(msgs[1].isStreaming).toBe(false);
    expect(msgs[1].content).toBe("partial");
  });
});
