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

    // The follow-up workflow blocks on an IDE "tasks" prompt; stop() so the test ends.
    workflow.on("workflowMessage", (msg) => {
      if (msg.type === KaiWorkflowMessageType.UserInteraction && msg.data.type === "tasks") {
        workflow.stop();
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

describe("KaiInteractiveWorkflow.stop (#1389 review)", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.promises.mkdtemp(pathlib.join(os.tmpdir(), "kai-stop-test-"));
    for (const name of ["A", "B", "C"]) {
      await fs.promises.writeFile(
        pathlib.join(workspaceDir, `${name}.java`),
        `public class ${name} {}`,
      );
    }
  });

  afterEach(async () => {
    await fs.promises.rm(workspaceDir, { recursive: true, force: true });
  });

  it("does not start the next file's model request after stop (direct mode)", async () => {
    const model = new FakeChatModelWithToolCalls({
      responses: [new AIMessage({ content: "# Reasoning\nNo changes required for this file." })],
    });
    const ref: { workflow?: KaiInteractiveWorkflow } = {};
    let modelCalls = 0;
    // Stop arrives while the first file's request is in flight.
    class StoppingProvider extends FakeModelProvider {
      invoke(...args: Parameters<FakeModelProvider["invoke"]>) {
        modelCalls++;
        ref.workflow?.stop();
        return super.invoke(...args);
      }
      stream(...args: Parameters<FakeModelProvider["stream"]>) {
        modelCalls++;
        ref.workflow?.stop();
        return super.stream(...args);
      }
    }
    const logger = winston.createLogger({
      level: "error",
      format: winston.format.json(),
      transports: [new winston.transports.Console({ silent: true })],
    });
    const workflow = new KaiInteractiveWorkflow(logger);
    ref.workflow = workflow;
    await workflow.init({
      modelProvider: new StoppingProvider(model, [], false, false),
      workspaceDir,
      fsCache: new InMemoryCacheWithRevisions<string, string>(true),
      toolCache: new FileBasedResponseCache<Record<string, any>, string>(
        false,
        (x) => JSON.stringify(x),
        (x) => JSON.parse(x) as string,
      ),
    });

    const incidents = ["A", "B", "C"].map((name) => ({
      uri: pathlib.join(workspaceDir, `${name}.java`),
      violationId: `v-${name}`,
      message: `issue ${name}`,
      ruleset_name: "rs",
      violation_name: "vn",
      violation_category: "mandatory" as const,
    }));

    const result = await workflow.run({
      incidents,
      enableAgentMode: false,
      programmingLanguage: "java",
      migrationHint: "JavaEE to Quarkus",
    });

    expect(result).toBeDefined();
    expect(workflow.isStopRequested()).toBe(true);
    expect(modelCalls).toBe(1);
  }, 20_000);
});
