// Modified from https://github.com/microsoft/vscode-languageserver-node/blob/main/client/src/common/client.ts

import * as vscode from "vscode";
import { Logger, ResponseError, Tracer } from "vscode-jsonrpc/node";

function isString(value: any): value is string {
  return typeof value === "string" || value instanceof String;
}

function data2String(data: object): string {
  if (data instanceof ResponseError) {
    const responseError = data as ResponseError<any>;
    return `  Message: ${responseError.message}\n  Code: ${responseError.code} ${responseError.data ? "\n" + responseError.data.toString() : ""}`;
  }
  if (data instanceof Error) {
    if (isString(data.stack)) {
      return data.stack;
    }
    return (data as Error).message;
  }
  if (isString(data)) {
    return data;
  }
  return data.toString();
}

const tracerToLogOutputChannel = (channel: vscode.LogOutputChannel): Tracer => {
  const logTrace = (message: string, data?: any) => {
    channel.info(message);
    if (data) {
      channel.info(data2String(data));
    }
  };

  const logObjectTrace = (data: any) => {
    if (data) {
      channel.info(JSON.stringify(data, null, 2));
    }
  };

  const log = (messageOrDataObject: string | any, data?: string) => {
    if (isString(messageOrDataObject)) {
      logTrace(messageOrDataObject, data);
    } else {
      logObjectTrace(messageOrDataObject);
    }
  };

  return { log };
};

/** Enable a `MessageConnection` to trace comms to a `LogOutputChannel`. */
export const tracer = (channelName: string): Tracer => {
  const traceLogChannel = vscode.window.createOutputChannel(channelName, {
    log: true,
  });
  return tracerToLogOutputChannel(traceLogChannel);
};

export const logger = (channel: vscode.LogOutputChannel): Logger => ({
  error: (message: string) => channel.error(message),
  warn: (message: string) => channel.warn(message),
  info: (message: string) => channel.info(message),
  log: (message: string) => channel.debug(message),
});
