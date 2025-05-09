import { AIMessage } from "@langchain/core/messages";

import { modelHealthCheck } from "../src/utils";
import { FakeChatModelWithToolCalls } from "./base";

describe("modelHealthCheck", () => {
  it("should have tools enabled for model with tool support", async () => {
    const model = new FakeChatModelWithToolCalls({
      responses: [
        new AIMessage({
          content: ``,
          tool_calls: [
            {
              id: "tool_call_id_000",
              args: {
                a: 2,
                b: 2,
              },
              name: "gamma",
              type: "tool_call",
            },
          ],
        }),
      ],
    });

    const { supportsTools, connected } = await modelHealthCheck(model);
    expect(supportsTools).toBe(true);
    expect(connected).toBe(true);
  });

  it("should not have tools enabled for model with no tool support", async () => {
    const model = new FakeChatModelWithToolCalls({
      responses: [
        new AIMessage({
          content: ``,
        }),
      ],
    });

    const { supportsTools, connected } = await modelHealthCheck(model);
    expect(supportsTools).toBe(false);
    expect(connected).toBe(true);
  });
});
