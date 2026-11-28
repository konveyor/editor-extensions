import winston from "winston";

export interface BoundedLogOptions {
  /** Objects nested deeper than this are replaced by a placeholder. */
  maxDepth: number;
  /** Strings longer than this are cut and annotated with the dropped length. */
  maxStringLength: number;
  /** Arrays, sets and maps keep this many entries. */
  maxEntries: number;
  /** Objects keep this many own enumerable keys. */
  maxKeys: number;
  /** Hard cap on the number of values visited for a single log record. */
  maxNodes: number;
}

export const DEFAULT_BOUNDED_LOG_OPTIONS: BoundedLogOptions = {
  maxDepth: 5,
  maxStringLength: 16 * 1024,
  maxEntries: 50,
  maxKeys: 100,
  maxNodes: 2000,
};

/**
 * Returns a JSON friendly copy of `value` whose size is bounded by `options`.
 *
 * Loggers serialize whatever they are handed. Passing a tree node, a store or
 * a response object can drag in a whole analysis result, and JSON.stringify
 * then either throws "Invalid string length" or returns a record that is
 * hundreds of megabytes long. Cycles and BigInt values throw as well.
 */
export function boundLogValue(
  value: unknown,
  options: BoundedLogOptions = DEFAULT_BOUNDED_LOG_OPTIONS,
): unknown {
  const ancestors = new Set<object>();
  let nodes = 0;

  const visit = (current: unknown, depth: number): unknown => {
    nodes += 1;
    if (nodes > options.maxNodes) {
      return "[Truncated]";
    }

    switch (typeof current) {
      case "string":
        return current.length > options.maxStringLength
          ? `${current.slice(0, options.maxStringLength)}... [${current.length - options.maxStringLength} more characters]`
          : current;
      case "bigint":
        return current.toString();
      case "function":
        return `[Function ${current.name || "anonymous"}]`;
      case "symbol":
        return current.toString();
      case "object":
        break;
      default:
        return current;
    }

    if (current === null) {
      return null;
    }
    const obj = current as object;
    if (ancestors.has(obj)) {
      return "[Circular]";
    }
    if (depth >= options.maxDepth) {
      return Array.isArray(obj) ? `[Array(${obj.length})]` : "[Object]";
    }

    ancestors.add(obj);
    try {
      if (obj instanceof Date) {
        return Number.isNaN(obj.getTime()) ? "Invalid Date" : obj.toISOString();
      }
      if (obj instanceof Error) {
        return {
          name: obj.name,
          message: visit(obj.message, depth + 1),
          stack: visit(obj.stack, depth + 1),
        };
      }
      if (Array.isArray(obj)) {
        return boundEntries(obj, depth);
      }
      if (obj instanceof Set) {
        return boundEntries(Array.from(obj), depth);
      }
      if (obj instanceof Map) {
        return boundEntries(Array.from(obj.entries()), depth);
      }

      const toJSON = (obj as { toJSON?: unknown }).toJSON;
      if (typeof toJSON === "function") {
        try {
          return visit(toJSON.call(obj), depth + 1);
        } catch {
          return "[Unserializable]";
        }
      }

      const out: Record<string, unknown> = {};
      const keys = Object.keys(obj);
      for (const key of keys.slice(0, options.maxKeys)) {
        try {
          out[key] = visit((obj as Record<string, unknown>)[key], depth + 1);
        } catch {
          out[key] = "[Unreadable]";
        }
      }
      if (keys.length > options.maxKeys) {
        out["..."] = `${keys.length - options.maxKeys} more keys`;
      }
      return out;
    } finally {
      ancestors.delete(obj);
    }
  };

  const boundEntries = (entries: unknown[], depth: number): unknown[] => {
    const out = entries.slice(0, options.maxEntries).map((entry) => visit(entry, depth + 1));
    if (entries.length > options.maxEntries) {
      out.push(`... ${entries.length - options.maxEntries} more items`);
    }
    return out;
  };

  return visit(value, 0);
}

/**
 * A winston format that bounds every field of a log record, so that one
 * careless `logger.info("...", { bigObject })` cannot stall the extension host
 * or fill the log file. Place it before `winston.format.json()`.
 */
export const boundedLogFormat = winston.format((info, opts): winston.Logform.TransformableInfo => {
  const options = { ...DEFAULT_BOUNDED_LOG_OPTIONS, ...(opts as Partial<BoundedLogOptions>) };
  for (const key of Object.keys(info)) {
    if (key === "level") {
      continue;
    }
    info[key] = boundLogValue(info[key], options);
  }
  return info;
});
