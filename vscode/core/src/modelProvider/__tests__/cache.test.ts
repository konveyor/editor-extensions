import expect from "expect";
import * as pathlib from "path";
import * as fs from "fs/promises";
import * as winston from "winston";
import { type CacheFilePaths } from "@editor-extensions/agentic";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";

import { getCacheForModelProvider } from "../utils";

describe("test FSCacheAndTracer", () => {
  const cacheDir = pathlib.join(__dirname, "_cache");
  const traceDir = pathlib.join(__dirname, "_trace");

  const verifyRecordsExist = async (result: CacheFilePaths | undefined) => {
    expect(result).toBeDefined();
    const outputFileStat = await fs.stat(result?.outputRecordPath ?? "");
    const inputFileStat = await fs.stat(result?.inputRecordPath ?? "");
    expect(outputFileStat.isFile()).toBe(true);
    expect(inputFileStat.isFile()).toBe(true);
  };

  const verifyTraceContent = async (
    result: CacheFilePaths | undefined,
    expectedInputContent: string,
    expectedOutputContent: string,
  ) => {
    expect(result).toBeDefined();
    const actualOutputContent = await fs.readFile(result?.outputRecordPath ?? "", "utf-8");
    expect(actualOutputContent).toBeDefined();
    expect(actualOutputContent).toStrictEqual(expectedOutputContent);
    const actualInputContent = await fs.readFile(result?.inputRecordPath ?? "", "utf-8");
    expect(actualInputContent).toBeDefined();
    expect(actualInputContent).toStrictEqual(expectedInputContent);
  };

  afterEach(async () => {
    await fs.rm(cacheDir, { recursive: true, force: true });
    await fs.rm(traceDir, { recursive: true, force: true });
  });

  it("should serialize and deserialize cache data properly when caching simple string input", async () => {
    const fsCache = getCacheForModelProvider(
      true,
      winston.createLogger({ silent: true }),
      cacheDir,
    );
    const cacheSubDir = "simpleMessage";
    // test basic string input
    const result = await fsCache.set("Hello", new AIMessage("world!"), {
      cacheSubDir,
    });
    expect(result).toBeDefined();
    await verifyRecordsExist(result);
    const actualOutput = await fsCache.get("Hello", {
      cacheSubDir,
    });
    expect(actualOutput).toBeDefined();
    expect(actualOutput?.content).toBe("world!");
  });

  it("should serialize and deserialize cache data properly when caching list of mixed set of messages", async () => {
    const fsCache = getCacheForModelProvider(
      true,
      winston.createLogger({ silent: true }),
      cacheDir,
    );
    // test list of mixed set of messages
    const longInput = [
      new HumanMessage("Hello"),
      new AIMessage({
        content: "",
        tool_calls: [
          {
            name: "whatComesNext",
            args: {
              word: "Hello",
            },
          },
        ],
      }),
      new ToolMessage({
        content: "World!",
        tool_call_id: "test",
      }),
    ];
    const cacheSubDir = "complexMessage";
    const result = await fsCache.set(longInput, new AIMessage("World!"), { cacheSubDir });
    await verifyRecordsExist(result);
    const actualOutput = await fsCache.get(longInput, { cacheSubDir });
    expect(actualOutput).toBeDefined();
    expect(actualOutput?.content).toBe("World!");
  });

  it("should serialize and deserialize data properly when tracing a simple string input", async () => {
    const fsTracer = getCacheForModelProvider(
      true,
      winston.createLogger({ silent: true }),
      traceDir,
      true,
    );
    const cacheSubDir = "simpleMessage";
    const result = await fsTracer.set("Hello", new AIMessage("world!"), {
      cacheSubDir,
      inputFileExt: "",
      outputFileExt: "",
    });
    await verifyRecordsExist(result);
    await verifyTraceContent(
      result,
      `Type: human
Content: Hello`,
      `Type: ai
Content: world!`,
    );
  });

  it("should serialize and deserialize data properly when tracing a list of mixed set of messages", async () => {
    const fsTracer = getCacheForModelProvider(
      true,
      winston.createLogger({ silent: true }),
      traceDir,
      true,
    );

    // test list of mixed set of messages
    const longInput = [
      new HumanMessage("Hello"),
      new AIMessage({
        content: "",
        tool_calls: [
          {
            name: "whatComesNext",
            args: {
              word: "Hello",
            },
          },
        ],
      }),
      new ToolMessage({
        content: "World!",
        tool_call_id: "test",
      }),
    ];
    const cacheSubDir = "complexMessage";
    const result = await fsTracer.set(longInput, new AIMessage("World!"), {
      cacheSubDir,
      inputFileExt: "",
      outputFileExt: "",
    });
    await verifyRecordsExist(result);
    await verifyTraceContent(
      result,
      `Type: human
Content: Hello

------------------------------

Type: ai
Tool Calls: [
  {
    "name": "whatComesNext",
    "args": {
      "word": "Hello"
    }
  }
]

------------------------------

Type: tool
Content: World!`,
      `Type: ai
Content: World!`,
    );
  });
});
