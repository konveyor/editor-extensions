import EventEmitter from "events";

import { type KaiWorkflowMessage } from "./types";

export class KaiWorkflowEventEmitter {
  private readonly eventEmitter: EventEmitter;

  constructor() {
    this.eventEmitter = new EventEmitter();
  }

  on(event: "workflowMessage", listener: (chunk: KaiWorkflowMessage) => void): this;
  on(event: "connectionLost", listener: () => void): this;
  on(event: string, listener: (...args: any[]) => void): this {
    this.eventEmitter.on(event, listener);
    return this;
  }

  protected emitWorkflowMessage(msg: KaiWorkflowMessage): boolean {
    return this.eventEmitter.emit("workflowMessage", msg);
  }

  protected emitConnectionLost(): boolean {
    return this.eventEmitter.emit("connectionLost");
  }

  public removeAllListeners() {
    this.eventEmitter.removeAllListeners();
  }
}
