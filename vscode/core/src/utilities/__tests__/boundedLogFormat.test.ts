import expect from "expect";
import { Writable } from "stream";
import winston from "winston";

import {
  boundedLogFormat,
  boundLogValue,
  DEFAULT_BOUNDED_LOG_OPTIONS,
  type BoundedLogOptions,
} from "../boundedLogFormat";

/**
 * Regression tests for the "Invalid string length" error that
 * `konveyor-core.openAnalysisDetails` threw when it logged a whole tree item.
 * The item held the issues model, so the logger tried to serialize every
 * incident of the analysis in a single record.
 */

const small: BoundedLogOptions = {
  maxDepth: 3,
  maxStringLength: 10,
  maxEntries: 3,
  maxKeys: 3,
  maxNodes: 1000,
};

function captureLogger(options?: Partial<BoundedLogOptions>) {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk).trimEnd());
      callback();
    },
  });
  const logger = winston.createLogger({
    format: winston.format.combine(
      winston.format.errors({ stack: true }),
      boundedLogFormat(options),
      winston.format.json(),
    ),
    transports: [new winston.transports.Stream({ stream })],
  });
  return { logger, lines };
}

/** Mimics IncidentTypeItem: a node that points back at a model holding every node. */
function buildIssuesModel(fileCount: number, referencesPerFile: number) {
  const model: { files: unknown[] } = { files: [] };
  for (let i = 0; i < fileCount; i++) {
    const file = {
      uri: `file:///workspace/node_modules/pkg-${i}/index.js`,
      model,
      references: Array.from({ length: referencesPerFile }, (_, n) => ({
        incident: { lineNumber: n, message: "x".repeat(200) },
      })),
    };
    model.files.push(file);
  }
  return { msg: "Replace deprecated API", files: model.files, model };
}

describe("boundLogValue", () => {
  it("passes primitives through unchanged", () => {
    expect(boundLogValue(42, small)).toBe(42);
    expect(boundLogValue(true, small)).toBe(true);
    expect(boundLogValue(null, small)).toBeNull();
    expect(boundLogValue(undefined, small)).toBeUndefined();
    expect(boundLogValue("short", small)).toBe("short");
  });

  it("cuts long strings and says how much was dropped", () => {
    expect(boundLogValue("a".repeat(25), small)).toBe(`${"a".repeat(10)}... [15 more characters]`);
  });

  it("keeps the first entries of a long array and counts the rest", () => {
    expect(boundLogValue([1, 2, 3, 4, 5], small)).toEqual([1, 2, 3, "... 2 more items"]);
  });

  it("keeps the first keys of a wide object and counts the rest", () => {
    expect(boundLogValue({ a: 1, b: 2, c: 3, d: 4, e: 5 }, small)).toEqual({
      a: 1,
      b: 2,
      c: 3,
      "...": "2 more keys",
    });
  });

  it("replaces objects below the depth limit with a placeholder", () => {
    const value = { l1: { l2: { l3: { l4: "deep" } }, arr: [[[1]]] } };
    expect(boundLogValue(value, small)).toEqual({
      l1: { l2: { l3: "[Object]" }, arr: ["[Array(1)]"] },
    });
  });

  it("marks cycles instead of recursing", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    a.list = [a];
    expect(boundLogValue(a, small)).toEqual({
      name: "a",
      self: "[Circular]",
      list: ["[Circular]"],
    });
  });

  it("does not call a shared, non cyclic object circular", () => {
    const shared = { n: 1 };
    expect(boundLogValue({ x: shared, y: shared }, small)).toEqual({ x: { n: 1 }, y: { n: 1 } });
  });

  it("serializes BigInt, which JSON.stringify rejects", () => {
    expect(boundLogValue({ size: BigInt("9007199254740993") }, small)).toEqual({
      size: "9007199254740993",
    });
  });

  it("keeps the useful parts of an Error", () => {
    const err = new TypeError("boom");
    const out = boundLogValue({ err }, DEFAULT_BOUNDED_LOG_OPTIONS) as {
      err: { name: string; message: string; stack: string };
    };
    expect(out.err.name).toBe("TypeError");
    expect(out.err.message).toBe("boom");
    expect(out.err.stack).toContain("boom");
  });

  it("honours toJSON and survives one that throws", () => {
    const uriLike = { toJSON: () => ({ scheme: "file", path: "/a" }) };
    const broken = {
      toJSON: () => {
        throw new Error("nope");
      },
    };
    expect(boundLogValue({ uriLike, broken }, small)).toEqual({
      uriLike: { scheme: "file", path: "/a" },
      broken: "[Unserializable]",
    });
  });

  it("survives a getter that throws", () => {
    const value = {
      ok: 1,
      get bad(): number {
        throw new Error("nope");
      },
    };
    expect(boundLogValue(value, small)).toEqual({ ok: 1, bad: "[Unreadable]" });
  });

  it("renders maps, sets, dates and functions", () => {
    const out = boundLogValue(
      {
        m: new Map([["k", 1]]),
        s: new Set([1, 2]),
        d: new Date("2026-01-02T03:04:05.000Z"),
        f: function named() {},
      },
      { ...small, maxKeys: 10 },
    );
    expect(out).toEqual({
      m: [["k", 1]],
      s: [1, 2],
      d: "2026-01-02T03:04:05.000Z",
      f: "[Function named]",
    });
  });

  it("stops visiting once the node budget is spent", () => {
    const wide = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => 1));
    const out = JSON.stringify(
      boundLogValue(wide, { ...small, maxEntries: 10, maxDepth: 5, maxNodes: 15 }),
    );
    expect(out).toContain("[Truncated]");
  });
});

describe("boundedLogFormat", () => {
  it("keeps ordinary records intact", () => {
    const { logger, lines } = captureLogger();
    logger.info("Registering provider: java", { name: "java", capabilities: ["a", "b"] });
    expect(JSON.parse(lines[0])).toEqual({
      level: "info",
      message: "Registering provider: java",
      name: "java",
      capabilities: ["a", "b"],
    });
  });

  it("keeps a logged Error's message and stack", () => {
    const { logger, lines } = captureLogger();
    logger.error("analysis failed", new Error("provider crashed"));
    const record = JSON.parse(lines[0]);
    expect(record.message).toContain("provider crashed");
    expect(record.stack).toContain("provider crashed");
  });

  it("bounds a record built from a tree item that points at the whole model", () => {
    const item = buildIssuesModel(20000, 5);
    const { logger, lines } = captureLogger();
    logger.info("Open details for item", { item });
    expect(lines).toHaveLength(1);
    expect(lines[0].length).toBeLessThan(100000);
    const record = JSON.parse(lines[0]);
    expect(record.message).toBe("Open details for item");
    expect(record.item.msg).toBe("Replace deprecated API");
  });

  it("logs a very large message string without throwing", () => {
    const { logger, lines } = captureLogger({ maxStringLength: 100 });
    logger.info("y".repeat(5000));
    expect(JSON.parse(lines[0]).message).toContain("more characters");
  });

  it("does not touch the level", () => {
    const { logger, lines } = captureLogger({ maxStringLength: 2 });
    logger.warn("hello");
    expect(JSON.parse(lines[0]).level).toBe("warn");
  });
});
