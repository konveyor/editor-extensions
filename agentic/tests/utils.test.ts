import { AIMessage } from "@langchain/core/messages";

import { FakeChatModelWithToolCalls } from "./base";
import { fileUriToPath, modelHealthCheck } from "../src/utils";

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

describe("fileUriToPath", () => {
  (process.platform !== "win32" ? it : it.skip)(
    "should correctly return linux/darwin paths",
    () => {
      const tc1 = "file:///root/coolstore/src/main/webapp/WEB-INF/web.xml";
      const tc2 = "/root/coolstore/src/main/webapp/WEB-INF/web.xml";

      expect(fileUriToPath(tc1)).toBe("/root/coolstore/src/main/webapp/WEB-INF/web.xml");
      expect(fileUriToPath(tc2)).toBe("/root/coolstore/src/main/webapp/WEB-INF/web.xml");
    },
  );

  (process.platform === "win32" ? it : it.skip)("should correctly return windows paths", () => {
    const tc1 = "file:///C:\\root\\coolstore\\src\\main\\webapp\\WEB-INF\\web.xml";
    const tc2 = "/C:\\root\\coolstore\\src\\main\\webapp\\WEB-INF\\web.xml";

    expect(fileUriToPath(tc1)).toBe("C:\\root\\coolstore\\src\\main\\webapp\\WEB-INF\\web.xml");
    expect(fileUriToPath(tc2)).toBe("C:\\root\\coolstore\\src\\main\\webapp\\WEB-INF\\web.xml");
  });
});
