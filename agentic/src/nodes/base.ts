import { z } from "zod";
import { Logger } from "winston";
import zodToJsonSchema from "zod-to-json-schema";
import { type BaseLanguageModelInput } from "@langchain/core/language_models/base";
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { type ToolCall } from "@langchain/core/messages/tool";
import { type MessagesAnnotation } from "@langchain/langgraph";
import { type DynamicStructuredTool } from "@langchain/core/tools";
import { type IterableReadableStream } from "@langchain/core/utils/stream";

import {
  type KaiWorkflowMessage,
  KaiWorkflowMessageType,
  type KaiModelProvider,
  type KaiModelProviderInvokeCallOptions,
} from "../types";
import { KaiWorkflowEventEmitter } from "../eventEmitter";

export abstract class BaseNode extends KaiWorkflowEventEmitter {
  constructor(
    private readonly name: string,
    protected readonly modelProvider: KaiModelProvider,
    private readonly tools: DynamicStructuredTool[],
    protected readonly logger: Logger,
  ) {
    super();

    // binding this is needed to work inside langgraph
    this.process_stream = this.process_stream.bind(this);
    this.runTools = this.runTools.bind(this);
    this.newMessageId = this.newMessageId.bind(this);
    this.streamOrInvoke = this.streamOrInvoke.bind(this);
    this.getInputWithTools = this.getInputWithTools.bind(this);
    this.aiMessageToString = this.aiMessageToString.bind(this);
    this.getToolsAsMessage = this.getToolsAsMessage.bind(this);
    this.getToolsMatchingSelectors = this.getToolsMatchingSelectors.bind(this);
    this.renderTextDescriptionAndArgs = this.renderTextDescriptionAndArgs.bind(this);
  }

  private newMessageId(prefix: string = "res"): string {
    return `${prefix}-${this.name}-${Date.now()}-${Array.from({ length: 5 }, () =>
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".charAt(
        Math.floor(Math.random() * 62),
      ),
    ).join("")}`;
  }

  /**
   * Calls <model>.stream and emits onMessage event with chunks retrieved.
   * Falls back to invoke() when native tools are supported but not in streaming.
   * If native tools are not supported, parses response on-the-fly and assembles
   * into tool_call_chunks making it transparent to callers.
   */
  protected async streamOrInvoke(
    input: BaseLanguageModelInput,
    streamOptions?: {
      enableTools?: boolean;
      // emitResponseChunks controls whether AImessagechunks are emitted as events
      emitResponseChunks?: boolean;
      // toolsSelector matches tool names to enable
      toolsSelectors?: string[];
    },
    options?: KaiModelProviderInvokeCallOptions | undefined,
  ): Promise<AIMessage | AIMessageChunk | undefined> {
    const messageId = this.newMessageId();
    const {
      enableTools = true,
      emitResponseChunks = true,
      toolsSelectors = [],
    } = streamOptions || {};
    try {
      // if we don't have tools enabled or registered, we should be able to stream without any issues
      if (!enableTools || !this.tools.length) {
        return this.process_stream(
          messageId,
          enableTools,
          emitResponseChunks,
          await this.modelProvider.stream(input, options),
        );
      }

      let runnable: KaiModelProvider = this.modelProvider;
      let processedInput: BaseLanguageModelInput = input;

      if (this.modelProvider.toolCallsSupported()) {
        runnable = this.modelProvider.bindTools(this.tools);
      } else {
        // use custom tool parsing if model does not support tool calls
        processedInput = this.getInputWithTools(input, toolsSelectors);
      }

      // use invoke if the model does not support streaming tool calls but supports normal tool calls
      if (
        this.modelProvider.toolCallsSupported() &&
        !this.modelProvider.toolCallsSupportedInStreaming()
      ) {
        const fullResponse = await runnable.invoke(processedInput, options);
        if (emitResponseChunks) {
          this.emitWorkflowMessage({
            id: messageId,
            type: KaiWorkflowMessageType.LLMResponse,
            data: fullResponse,
          });
        }
        return fullResponse;
      }

      return this.process_stream(
        messageId,
        enableTools,
        emitResponseChunks,
        await runnable.stream(processedInput, options),
      );
    } catch (err) {
      this.logger.error("Error callling stream()", { error: err });
      if (emitResponseChunks) {
        this.emitWorkflowMessage({
          id: messageId,
          type: KaiWorkflowMessageType.Error,
          data: `Failed to get llm response - ${String(err)}`,
        });
      }
    }
  }

  private async process_stream(
    messageId: string,
    enableTools: boolean,
    emitResponseChunks: boolean,
    stream: IterableReadableStream<AIMessageChunk>,
  ): Promise<AIMessageChunk | undefined> {
    let response: AIMessageChunk | undefined;

    // re-assembling content
    let buffer: string = "";
    let parserState: string = "content";
    const toolCalls: ToolCall[] = [];

    for await (const chunk of stream) {
      if (!response) {
        response = chunk;
      } else {
        response = response.concat(chunk);
      }
      // for native tools support or when we don't expect tool calls
      // we send the chunk as-is
      if (this.modelProvider.toolCallsSupported() || !enableTools) {
        if (emitResponseChunks) {
          this.emitWorkflowMessage({
            id: messageId,
            type: KaiWorkflowMessageType.LLMResponseChunk,
            data: chunk,
          });
        }
        continue;
      }

      // re-assemble the chunk if this is a non-native tool call
      buffer += chunk.content;
      let continueReading = false;
      while (buffer.length > 0) {
        switch (parserState) {
          case "content": {
            const toolCallMarkerIdx = buffer.indexOf("TOOL_CALL");
            // sometimes models do not add TOOL_CALL word
            const toolCallBlockIdx = buffer.indexOf("```");
            if (
              toolCallBlockIdx !== -1 &&
              toolCallMarkerIdx !== -1 &&
              toolCallBlockIdx < toolCallMarkerIdx
            ) {
              parserState = "toolCallBegin";
              if (emitResponseChunks) {
                this.emitWorkflowMessage({
                  id: messageId,
                  type: KaiWorkflowMessageType.LLMResponseChunk,
                  data: new AIMessageChunk(buffer.substring(0, toolCallMarkerIdx).trim()),
                });
              }
              buffer = buffer.substring(toolCallBlockIdx + 3);
            } else if (toolCallMarkerIdx !== -1) {
              parserState = "toolCallMarkerRead";
              if (emitResponseChunks) {
                this.emitWorkflowMessage({
                  id: messageId,
                  type: KaiWorkflowMessageType.LLMResponseChunk,
                  data: new AIMessageChunk(buffer.substring(0, toolCallMarkerIdx).trim()),
                });
              }
              buffer = buffer.substring(toolCallMarkerIdx + "TOOL_CALL".length);
            } else if (toolCallBlockIdx !== -1) {
              parserState = "toolCallBegin";
              if (emitResponseChunks) {
                this.emitWorkflowMessage({
                  id: messageId,
                  type: KaiWorkflowMessageType.LLMResponseChunk,
                  data: new AIMessageChunk(buffer.substring(0, toolCallMarkerIdx).trim()),
                });
              }
              buffer = buffer.substring(toolCallBlockIdx + 3);
            } else {
              continueReading = true;
            }
            break;
          }
          case "toolCallMarkerRead": {
            const toolCallBlockIdx = buffer.indexOf("```");
            if (toolCallBlockIdx !== -1) {
              parserState = "toolCallBegin";
              buffer = buffer.substring(toolCallBlockIdx + 3);
            } else {
              continueReading = true;
            }
            break;
          }
          case "toolCallBegin": {
            const toolCallBlockEndIdx = buffer.indexOf("```");
            if (toolCallBlockEndIdx !== -1) {
              let toolCall = buffer.substring(0, toolCallBlockEndIdx).trim();
              if (toolCall.startsWith("json")) {
                toolCall = toolCall.substring("json".length);
              }
              buffer = buffer.substring(toolCallBlockEndIdx + 3).trim();
              parserState = "content";
              if (toolCall) {
                try {
                  const parsedToolCall = JSON.parse(toolCall.trim());
                  let tool_name: string | undefined;
                  let tool_args: Record<string, any> | undefined;
                  if ("tool_name" in parsedToolCall) {
                    tool_name = parsedToolCall["tool_name"];
                  }
                  if ("args" in parsedToolCall) {
                    tool_args = parsedToolCall["args"];
                  }
                  if (tool_args && tool_name) {
                    toolCalls.push({
                      args: tool_args,
                      name: tool_name,
                      id: messageId,
                    });
                  } else {
                    console.warn(`Malformed tool call in response - ${toolCall}`);
                  }
                } catch (err) {
                  console.warn(`Failed to parse tool call - ${toolCall} - ${err}`);
                }
              }
            } else {
              continueReading = true;
            }
            break;
          }
        }
        if (continueReading) {
          break;
        }
      }
    }
    // if we haven't seen a tool call, send everything else as content
    if (parserState === "content" && buffer.length > 0 && emitResponseChunks) {
      this.emitWorkflowMessage({
        id: messageId,
        type: KaiWorkflowMessageType.LLMResponseChunk,
        data: new AIMessageChunk(buffer),
      });
    }
    if (response && !this.modelProvider.toolCallsSupported()) {
      response.tool_calls = toolCalls;
    }
    return response;
  }

  private getInputWithTools(
    input: BaseLanguageModelInput,
    toolSelectors: string[] = [],
  ): BaseLanguageModelInput {
    const filteredTools = this.getToolsMatchingSelectors(toolSelectors);
    // NOTE: This assumes that all messages we will send will either
    // be a list of BaseMessage or strings. we are not adding tools support
    // for all possible values of BaseLanguageModelInput. If you are seeing
    // your requests producing errors or weird output, this is the place to look
    if (typeof input === "string") {
      return [new SystemMessage(this.getToolsAsMessage(filteredTools)), new HumanMessage(input)];
    } else if (Array.isArray(input)) {
      let modified = [];
      if (input.length > 0 && input[0] instanceof SystemMessage) {
        modified = [
          new SystemMessage(input[0].content + this.getToolsAsMessage(filteredTools)),
          ...input.slice(1),
        ];
      } else {
        modified = [new SystemMessage(this.getToolsAsMessage(filteredTools)), ...input];
      }
      // we have to reset previously added tool_calls so as to not confuse the model
      modified.forEach((m) => {
        if (m instanceof AIMessage || m instanceof AIMessageChunk) {
          m.tool_calls = [];
        }
      });
      return modified;
    }
    return [];
  }

  private getToolsAsMessage(tools: DynamicStructuredTool[]): string {
    if (!tools || tools.length < 1) {
      return "";
    }
    return `You are an intelligent developer. You are designed to use tools to answer user questions.\
You may not know all of the information to address user's needs. You will use relevant tools to get that information.\
Here is the schema of tools you are given:

${this.renderTextDescriptionAndArgs(tools)}

If you do need to call a tool, respond with text 'TOOL_CALL' on a new line followed by a JSON object on the next line containing only two keys - tool_name and args.\
'tool_name' should be the name of the tool to call. 'args' should be nested JSON containing the arguments to pass to the function in key value format.
Make sure you always use \`\`\` at the start and end of the JSON block to clearly separate it from text.\
*Crucially* you must only output one tool call at a time. After the tool call, wait for the results before considering another tool call if necessary.
`;
  }

  private renderTextDescriptionAndArgs(tools: DynamicStructuredTool[]): string {
    let description = "";
    tools.forEach((tool) => {
      description += `${tool.name}: ${tool.description}, Args: ${JSON.stringify(zodToJsonSchema(tool.schema as z.ZodSchema))}\n`;
    });
    return description;
  }

  async runTools(state: typeof MessagesAnnotation.State) {
    const toolCallResponses: ToolMessage[] = [];
    const nonToolCallResponses: string[] = [];
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    const toolCalls = lastMessage.tool_calls!;

    for (const toolCall of toolCalls) {
      let tool: DynamicStructuredTool | undefined = undefined;
      for (const availableTool of this.tools) {
        if (toolCall.name === availableTool.name) {
          tool = availableTool;
        }
      }
      if (!tool) {
        return {
          messages: new HumanMessage(`The tool ${toolCall.name} does not exist`),
        };
      }
      toolCall.id = toolCall.id ? toolCall.id : this.newMessageId("tool-call");
      const toolCallEvent: KaiWorkflowMessage = {
        type: KaiWorkflowMessageType.ToolCall,
        id: toolCall.id,
        data: {
          id: toolCall.id,
          status: "running",
          args: JSON.stringify(toolCall.args),
          name: toolCall.name,
        },
      };
      try {
        this.emitWorkflowMessage(toolCallEvent);
        const result = await tool.invoke(toolCall.args);
        if (this.modelProvider.toolCallsSupported()) {
          toolCallResponses.push(
            new ToolMessage({
              content: result,
              tool_call_id: toolCall.id!,
              name: toolCall.name,
            }),
          );
        } else {
          nonToolCallResponses.push(
            `The response from the tool ${toolCall.name} is:\n\`\`\`${result}\`\`\``,
          );
        }
        this.emitWorkflowMessage({
          ...toolCallEvent,
          type: toolCallEvent.type,
          data: {
            ...toolCallEvent.data,
            status: "succeeded",
          },
        });
      } catch (err) {
        this.emitWorkflowMessage({
          ...toolCallEvent,
          type: toolCallEvent.type,
          data: {
            ...toolCallEvent.data,
            status: "failed",
          },
        });
        if (this.modelProvider.toolCallsSupported()) {
          toolCallResponses.push(
            new ToolMessage({
              content: err instanceof Error ? err.message || String(err) : String(err),
              tool_call_id: toolCall.id!,
              name: toolCall.name,
            }),
          );
        } else {
          nonToolCallResponses.push(
            `There was an error running the tool ${toolCall.name} with args ${toolCall.args} - ${String(err)}`,
          );
        }
      }
    }
    if (this.modelProvider.toolCallsSupported()) {
      return { messages: toolCallResponses };
    } else {
      return { messages: new HumanMessage(nonToolCallResponses.join("\n\n")) };
    }
  }

  protected aiMessageToString(msg: AIMessage | AIMessageChunk | undefined): string {
    if (!msg) {
      return "";
    }
    return typeof msg?.content === "string"
      ? msg.content
      : msg?.content
        ? JSON.stringify(msg.content)
        : "";
  }

  private getToolsMatchingSelectors(selectors?: string[]): DynamicStructuredTool[] {
    if (!selectors || !selectors.length) {
      return this.tools;
    }
    return this.tools.filter((tool) => {
      return selectors.some((selector) => {
        if (selector === tool.name) {
          return true;
        }

        try {
          const pattern = new RegExp(selector);
          if (pattern.test(tool.name)) {
            return true;
          }
        } catch {
          return false;
        }
        return false;
      });
    });
  }
}
