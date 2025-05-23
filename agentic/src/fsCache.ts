import EventEmitter from "events";

import { type KaiFsCache } from "./types";

export class SimpleInMemoryCache implements KaiFsCache {
  private cache: Map<string, string>;
  private readonly eventEmitter: EventEmitter;

  constructor() {
    this.eventEmitter = new EventEmitter();
    this.cache = new Map<string, string>();
  }

  on(event: "cacheInvalidated", listener: (uri: string) => void): this;
  on(event: "cacheSet", listener: (uri: string, content: string) => void): this;
  on(event: string, listener: (...args: any[]) => void) {
    this.eventEmitter.on(event, listener);
    return this;
  }

  async invalidate(uri: string): Promise<void> {
    if (this.cache.has(uri)) {
      this.cache.delete(uri);
      this.eventEmitter.emit("cacheInvalidated", uri);
    }
  }

  async set(uri: string, content: string): Promise<void> {
    this.cache.set(uri, content);
    this.eventEmitter.emit("cacheSet", uri, content);
  }

  async get(uri: string): Promise<string | undefined> {
    return this.cache.get(uri);
  }

  async reset(): Promise<void> {
    this.cache.clear();
  }
}
