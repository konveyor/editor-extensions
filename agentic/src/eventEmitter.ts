import EventEmitter from "events";
import { KaiWorkflowMessage } from "./types";

export class KaiWorkflowEventEmitter extends EventEmitter {
  on(event: "workflowMessage", listener: (chunk: KaiWorkflowMessage) => void): this;
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  protected emitWorkflowMessage(msg: KaiWorkflowMessage): boolean {
    return this.emit("workflowMessage", msg);
  }
}
