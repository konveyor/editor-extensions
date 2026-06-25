import * as fs from "fs";
import * as os from "os";
import * as pathlib from "path";

import { AIMessage } from "@langchain/core/messages";
import * as winston from "winston";

import { FileBasedResponseCache, InMemoryCacheWithRevisions, KaiWorkflowMessageType } from "../src";
import { KaiInteractiveWorkflow } from "../src/workflows/interactiveWorkflow";
import { FakeChatModelWithToolCalls, FakeModelProvider } from "./base";

describe("KaiInteractiveWorkflow.run (issue #1418)", () => {
  let workspaceDir: string;
  let fileA: string;
  let fileB: string;

  beforeEach(async () => {
    workspaceDir = await fs.promises.mkdtemp(pathlib.join(os.tmpdir(), "kai-test-"));
    fileA = pathlib.join(workspaceDir, "A.java");
    fileB = pathlib.join(workspaceDir, "B.java");
    await fs.promises.writeFile(fileA, "public class A {}");
    await fs.promises.writeFile(fileB, "public class B {}");
  });

  afterEach(async () => {
    await fs.promises.rm(workspaceDir, { recursive: true, force: true });
  });

  it("completes when the LLM yields no Updated File for two incidents in agent mode", async () => {
    const responses = [
      new AIMessage({ content: "# Reasoning\nNo changes required for this file." }),
    ];
    const model = new FakeChatModelWithToolCalls({ responses });
    const provider = new FakeModelProvider(model, [], false, false);
    const fsCache = new InMemoryCacheWithRevisions<string, string>(true);
    const toolCache = new FileBasedResponseCache<Record<string, any>, string>(
      false,
      (x) => JSON.stringify(x),
      (x) => JSON.parse(x) as string,
    );
    const logger = winston.createLogger({
      level: "error",
      format: winston.format.json(),
      transports: [new winston.transports.Console({ silent: true })],
    });
    const workflow = new KaiInteractiveWorkflow(logger);

    await workflow.init({
      modelProvider: provider,
      workspaceDir,
      fsCache,
      toolCache,
    });

    const incidents = [
      {
        uri: fileA,
        violationId: "v1",
        message: "issue A",
        ruleset_name: "rs",
        violation_name: "vn",
        violation_category: "mandatory" as const,
      },
      {
        uri: fileB,
        violationId: "v2",
        message: "issue B",
        ruleset_name: "rs",
        violation_name: "vn",
        violation_category: "mandatory" as const,
      },
    ];

    // The follow-up workflow blocks on an IDE "tasks" prompt; resolve it so the test ends.
    workflow.on("workflowMessage", (msg) => {
      if (msg.type === KaiWorkflowMessageType.UserInteraction && msg.data.type === "tasks") {
        workflow.resolveUserInteraction({
          id: msg.id,
          type: KaiWorkflowMessageType.UserInteraction,
          data: { type: "tasks", systemMessage: {}, response: { yesNo: false } },
        });
      }
    });

    const result = await workflow.run({
      incidents,
      enableAgentMode: true,
      programmingLanguage: "java",
      migrationHint: "JavaEE to Quarkus",
    });
    expect(result).toBeDefined();
  }, 20_000);
});
