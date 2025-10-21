import * as fs from "fs";
import { createLogger } from "winston";
import expect from "expect";
import * as https from "https";
import * as pathlib from "path";
import { spawn, execFile, type ChildProcess } from "child_process";
import {
  type BindToolsInput,
  type BaseChatModelCallOptions,
} from "@langchain/core/language_models/chat_models";
import { Runnable } from "@langchain/core/runnables";
import { AIMessageChunk, AIMessage } from "@langchain/core/messages";
import { FakeStreamingChatModel } from "@langchain/core/utils/testing";
import { type BaseLLMParams } from "@langchain/core/language_models/llms";
import { type BaseLanguageModelInput } from "@langchain/core/language_models/base";

import { ModelCreators } from "../modelCreator";
import { runModelHealthCheck } from "../modelProvider";
import { ParsedModelConfig } from "../types";

class FakeChatModelWithToolCalls extends FakeStreamingChatModel {
  private ai_responses: AIMessage[];
  constructor(
    fields: {
      sleep?: number;
      responses?: AIMessage[];
      thrownErrorString?: string;
    } & BaseLLMParams,
  ) {
    super(fields);
    this.ai_responses = fields.responses!;
  }

  bindTools(
    _tools: BindToolsInput[],
    _kwargs?: Partial<BaseChatModelCallOptions> | undefined,
  ): Runnable<BaseLanguageModelInput, AIMessageChunk, BaseChatModelCallOptions> {
    return this;
  }

  async invoke(
    input: BaseLanguageModelInput,
    options?: BaseChatModelCallOptions | undefined,
  ): Promise<AIMessageChunk> {
    const response = await super.invoke(input, options);

    const matchingRes = this.ai_responses.find((item) => item.content === response.content);
    if (matchingRes) {
      response.tool_calls = matchingRes.tool_calls;
    }
    return response;
  }
}

describe("model health check test", () => {
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

    const { supportsTools } = await runModelHealthCheck(model, model);
    expect(supportsTools).toBe(true);
  });

  it("should not have tools enabled for model with no tool support", async () => {
    const model = new FakeChatModelWithToolCalls({
      responses: [
        new AIMessage({
          content: ``,
        }),
      ],
    });

    const { supportsTools } = await runModelHealthCheck(model, model);
    expect(supportsTools).toBe(false);
  });
});

// In this test, we are interested in running only the provider client with self-signed certs
// We will be setting up a mock server with self-signed certs.  The goal is to only verify if the connection works.
// NOTE: Since we are only testing the provider client, and its a headache to start this server in all envs,
// it is sufficient to test this on linux alone. An e2e test with OpenShift AI will be added later anyway.
(process.platform === "linux" ? describe : describe.skip)("Self-signed certs test", () => {
  const scriptsDir = pathlib.join(__dirname, "scripts");
  const certsDir = pathlib.join(scriptsDir, ".certs");
  const mockServerPath = pathlib.join(scriptsDir, "fakeLLMServer.js");
  const certsGenScriptPath = pathlib.join(scriptsDir, "genCerts.sh");
  const logger = createLogger({ silent: true });

  let serverProc: ChildProcess | null = null;

  const configs: Record<string, ParsedModelConfig> = {
    openai: {
      config: {
        provider: "ChatOpenAI",
        args: {
          model: "test-model",
          configuration: {
            baseURL: "https://localhost:8443/v1",
            timeout: 1000,
          },
          timeout: 1000,
        },
      },
      env: {
        ALLOW_INSECURE: "false",
        CA_BUNDLE: pathlib.join(certsDir, "ca.crt"),
        OPENAI_API_KEY: "test-key",
      },
    },
  };

  // setting up the server
  before(async function (this: Mocha.Context) {
    this.timeout(15000); // 15 seconds for server setup
    await new Promise<void>((resolve, reject) => {
      execFile("bash", [certsGenScriptPath], { cwd: scriptsDir }, (err) =>
        err ? reject(err) : resolve(),
      );
    });
    serverProc = spawn(process.execPath, [mockServerPath], {
      cwd: scriptsDir,
      env: {
        ...process.env,
        SERVER_CERT: pathlib.join(certsDir, "srv.crt"),
        SERVER_KEY: pathlib.join(certsDir, "srv.key"),
        CA_CERT: pathlib.join(certsDir, "ca.crt"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let exitedEarly = false;
    let earlyExitMsg = "";
    const stderrChunks: Buffer[] = [];
    serverProc.on("exit", (code, signal) => {
      exitedEarly = true;
      earlyExitMsg = `mock server exited early (code=${code}, signal=${signal})`;
    });
    serverProc.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    const ca = fs.readFileSync(pathlib.join(certsDir, "ca.crt"));
    const deadlineMs = 10000;
    const start = Date.now();
    let lastError: string = "";
    const tryOnce = async (): Promise<boolean> =>
      await new Promise<boolean>((resolve) => {
        const req = https.request(
          {
            hostname: "localhost",
            port: 8443,
            path: "/",
            method: "GET",
            rejectUnauthorized: true,
            ca,
            timeout: 1000,
          },
          (res) => {
            res.resume();
            // Check for successful HTTP status
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(true);
            } else {
              lastError = `HTTP ${res.statusCode}`;
              resolve(false);
            }
          },
        );
        req.on("error", (error) => {
          lastError = error.message;
          resolve(false);
        });
        req.end();
      });

    while (Date.now() - start < deadlineMs) {
      if (exitedEarly) {
        const stderrStr = Buffer.concat(stderrChunks).toString("utf8").trim();
        throw new Error(`${earlyExitMsg}${stderrStr ? `\nSTDERR:\n${stderrStr}` : ""}`);
      }
      if (await tryOnce()) {
        console.log(`Mock server ready after ${Date.now() - start}ms`);
        return;
      }
      await new Promise((r) => setTimeout(r, 200)); // Slightly longer delay between attempts
    }
    if (serverProc) {
      serverProc.kill("SIGKILL");
      serverProc = null;
    }
    throw new Error(`mock HTTPS server failed to start within 10s. Last error: ${lastError}`);
  });

  it("should connect to the server when self-signed certs are used", async function (this: Mocha.Context) {
    this.timeout(8000);
    try {
      const openaiConfig = JSON.parse(JSON.stringify(configs.openai));
      const modelCreator = ModelCreators[openaiConfig.config.provider](logger);
      const modelProvider = await modelCreator.create(openaiConfig.config.args, openaiConfig.env);
      await modelProvider.invoke("Hello, world!");
    } catch (error) {
      console.error(error);
      throw new Error("Failed to connect to the server, this should not happen");
    }
  });

  async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let handle: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      handle = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      clearTimeout(handle!);
    }
  }

  it("should error when certs are not used with mock server that expects them", async function (this: Mocha.Context) {
    this.timeout(7000);
    try {
      const openaiConfig = JSON.parse(JSON.stringify(configs.openai));
      openaiConfig.env.CA_BUNDLE = "";
      const modelCreator = ModelCreators[openaiConfig.config.provider](logger);
      const modelProvider = await modelCreator.create(openaiConfig.config.args, openaiConfig.env);
      await withTimeout(modelProvider.invoke("Hello, world!"), 5000); // if the response is hanging for 5 seconds, connecton is not established
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  it("should NOT error when certs are not used but insecure is set", async function (this: Mocha.Context) {
    this.timeout(7000);
    try {
      const openaiConfig = JSON.parse(JSON.stringify(configs.openai));
      openaiConfig.env.CA_BUNDLE = "";
      openaiConfig.env.ALLOW_INSECURE = "true";
      const modelCreator = ModelCreators[openaiConfig.config.provider](logger);
      const modelProvider = await modelCreator.create(openaiConfig.config.args, openaiConfig.env);
      await modelProvider.invoke("Hello, world!");
    } catch (error) {
      console.error(error);
      throw new Error("Failed to connect to the server, this should not happen");
    }
  });

  after(function (this: Mocha.Context) {
    this.timeout(5000);
    if (serverProc && !serverProc.killed) {
      serverProc.kill("SIGKILL");
      serverProc = null;
    }
    fs.rmSync(certsDir, { recursive: true, force: true });
  });
});
