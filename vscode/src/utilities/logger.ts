import * as winston from "winston";
import * as vscode from "vscode";
import * as path from "path";
import { ExtensionPaths } from "../paths";
import { OutputChannelTransport } from "winston-transport-vscode";
import { getConfigLogLevel } from "./configuration";
import { KONVEYOR_OUTPUT_CHANNEL_NAME } from "@editor-extensions/shared";

// Create logger instance
export function createLogger(paths: ExtensionPaths): winston.Logger {
  // Create or get the output channel
  const outputChannel = vscode.window.createOutputChannel(KONVEYOR_OUTPUT_CHANNEL_NAME, "log");

  // Create log file path
  const logFile = path.join(paths.serverLogs.fsPath, "konveyor-extension.log");

  const logger = winston.createLogger({
    level: getConfigLogLevel(),
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json(),
    ),
    transports: [
      // File transport
      new winston.transports.File({
        filename: logFile,
        maxsize: 10 * 1024 * 1024, // 10MB
        maxFiles: 3,
      }),
      // VS Code output channel transport
      new OutputChannelTransport({
        outputChannel,
        level: "warn",
      }),
    ],
  });

  // Add console transport in development mode
  if (process.env.NODE_ENV === "development") {
    logger.add(
      new winston.transports.Console({
        level: "silly",
      }),
    );
  }

  logger.info("Logger created");
  return logger;
}
