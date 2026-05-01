import * as pathlib from "path";
import * as fs from "fs/promises";
import * as winston from "winston";
import { createHash } from "crypto";
import { type InputOutputCache } from "@editor-extensions/shared";

export interface CacheFilePaths {
  inputRecordPath: string;
  outputRecordPath: string;
}

export interface FileBasedCacheOptions {
  cacheSubDir?: string;
  inputFileExt?: string;
  outputFileExt?: string;
}

/**
 * A file-based cache implementation that caches generic inputs and outputs on disk.
 *
 * @template K - The type of the input to cache e.g. LLM Input Prompt(s).
 * @template V - The type of the output to cache e.g. LLM Response.
 * @template C - The coordinates of the cache - paths to cache files.
 * @template O - Additional options for the cache.
 */
export class FileBasedResponseCache<K, V>
  implements InputOutputCache<K, V, CacheFilePaths, FileBasedCacheOptions>
{
  enabled: boolean;

  constructor(
    enabled: boolean,
    private readonly serializeFunction: (input: K | V) => string,
    private readonly deserializeFunction: (input: string) => V,
    private readonly cacheDir?: string,
    private readonly logger?: winston.Logger,
    private readonly hashFunction?: (input: K | V) => string,
  ) {
    this.enabled = enabled;
  }

  async get(input: K, opts?: FileBasedCacheOptions): Promise<V | undefined> {
    if (!this.enabled) {
      return undefined;
    }

    const cachePath = pathlib.join(
      this.cacheDir ?? "",
      opts?.cacheSubDir ?? "",
      this.hashFunction ? this.hashFunction(input) : this.hash(input),
      `output${opts?.outputFileExt ?? ".json"}`,
    );
    this.logger?.silly("Getting cache", { cachePath, input });

    try {
      const stat = await fs.stat(cachePath);
      if (stat.isFile()) {
        const data = await fs.readFile(cachePath, "utf-8");
        return this.deserializeFunction(data);
      }
    } catch (err) {
      this.logger?.error("Error looking up cache", err);
    }

    return undefined;
  }

  async set(input: K, value: V, opts?: FileBasedCacheOptions): Promise<CacheFilePaths | undefined> {
    if (!this.enabled) {
      return undefined;
    }

    const cacheBasePath = pathlib.join(
      this.cacheDir ?? "",
      opts?.cacheSubDir ?? "",
      this.hashFunction ? this.hashFunction(input) : this.hash(input),
    );
    this.logger?.silly("Setting cache", { cacheBasePath, input });

    try {
      const inputRecordPath = pathlib.join(cacheBasePath, `input${opts?.inputFileExt ?? ".json"}`);
      const outputRecordPath = pathlib.join(
        cacheBasePath,
        `output${opts?.outputFileExt ?? ".json"}`,
      );
      await fs.mkdir(cacheBasePath, { recursive: true });
      await fs.writeFile(inputRecordPath, this.serializeFunction(input));
      await fs.writeFile(outputRecordPath, this.serializeFunction(value));
      return {
        inputRecordPath,
        outputRecordPath,
      };
    } catch (err) {
      this.logger?.error("Error updating cache", { error: err });
    }

    return undefined;
  }

  private hash(input: K): string {
    return createHash("sha256").update(this.serializeFunction(input)).digest("hex").slice(0, 16);
  }

  async invalidate(input: K, opts?: FileBasedCacheOptions): Promise<void> {
    return await fs.rm(
      pathlib.join(this.cacheDir ?? "", opts?.cacheSubDir ?? "", this.hash(input)),
      {
        recursive: true,
        force: true,
      },
    );
  }

  async reset(): Promise<void> {
    return await fs.rm(this.cacheDir ?? "", { recursive: true, force: true });
  }
}

export interface InMemoryCacheWithRevisionsOptions {
  maxRevisions: number;
}

export const ALL_REVISIONS = -1;

/**
 * A memory-based cache implementation that caches generic inputs and outputs.
 * Supports storing multiple revisions of the same input. Useful for caching fs changes.
 *
 * @template K - The type of the input to cache, must be hashable.
 * @template V - The type of the value for the given input to cache.
 * @template C - undefined (coordinates not available for in-memory cache).
 * @template O - Any additional options.
 */
export class InMemoryCacheWithRevisions<K, V>
  implements InputOutputCache<K, V, void, InMemoryCacheWithRevisionsOptions>
{
  private readonly cache: Map<K, V[]>;
  enabled: boolean;

  constructor(enabled: boolean) {
    this.enabled = enabled;
    this.cache = new Map<K, V[]>();
  }

  async get(input: K, _opts?: InMemoryCacheWithRevisionsOptions): Promise<V | undefined> {
    if (!this.enabled) {
      return undefined;
    }
    const stack = this.cache.get(input);
    if (!stack || stack.length === 0) {
      return undefined;
    }
    return stack[stack.length - 1];
  }

  async set(input: K, value: V, _opts?: InMemoryCacheWithRevisionsOptions): Promise<void> {
    if (!this.enabled) {
      return;
    }
    const existingStack = this.cache.get(input);
    if (existingStack) {
      existingStack.push(value);
    } else {
      this.cache.set(input, [value]);
    }
  }

  async invalidate(input: K, opts?: InMemoryCacheWithRevisionsOptions): Promise<void> {
    if (!this.enabled) {
      return;
    }
    const stack = this.cache.get(input);
    if (!stack || stack.length === 0) {
      return;
    }
    const revisionsToRemove = opts?.maxRevisions ?? 1;
    if (revisionsToRemove === ALL_REVISIONS) {
      this.cache.delete(input);
      return;
    }
    for (let i = 0; i < revisionsToRemove && stack.length > 0; i++) {
      stack.pop();
    }
    if (stack.length === 0) {
      this.cache.delete(input);
    }
  }

  async reset(): Promise<void> {
    if (!this.enabled) {
      return;
    }
    this.cache.clear();
  }
}
