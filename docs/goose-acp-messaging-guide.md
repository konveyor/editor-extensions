# Goose ACP Messaging System -- Integration Guide

This document provides a comprehensive analysis of the `vscode-goose` extension's messaging system, covering the ACP (Agent Communication Protocol) over JSON-RPC 2.0, the webview-extension bridge, streaming architecture, and session management. It is intended for developers who need to integrate with Goose's ACP protocol from a VS Code extension.

**Source repository:** <https://github.com/block/vscode-goose>

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [ACP Protocol Details (JSON-RPC 2.0 over stdio)](#2-acp-protocol-details)
3. [Webview <-> Extension Messaging](#3-webview--extension-messaging)
4. [Streaming Architecture](#4-streaming-architecture)
5. [Session Management](#5-session-management)
6. [Key Considerations for Integration](#6-key-considerations-for-integration)

---

## 1. Architecture Overview

The system has three layers connected by two messaging boundaries:

```
+------------------+       postMessage        +---------------------+       JSON-RPC/ndjson       +------------------+
|   React Webview  | <======================> |  Extension Backend  | <=========================> |   goose acp      |
|   (webview-ui)   |   VS Code IPC bridge     |  (Node.js host)     |   stdin/stdout (subprocess) |   (subprocess)   |
+------------------+                          +---------------------+                             +------------------+
```

**Boundary 1 -- Webview <-> Extension:** Uses VS Code's `postMessage` API with typed message envelopes (`{ type, payload }`).

**Boundary 2 -- Extension <-> goose acp:** Uses JSON-RPC 2.0 over newline-delimited JSON (ndjson) via the subprocess's stdin/stdout pipes.

**Key source files:**

| File                                 | Purpose                                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `src/extension/jsonRpcClient.ts`     | JSON-RPC 2.0 client (ndjson framing, request/response correlation, notification dispatch) |
| `src/extension/subprocessManager.ts` | Subprocess lifecycle (spawn, SIGTERM/SIGKILL, status tracking)                            |
| `src/extension/sessionManager.ts`    | Session CRUD, ACP session/new and session/load orchestration                              |
| `src/extension/webviewProvider.ts`   | WebviewViewProvider, message queuing, ready-signal handshake                              |
| `src/extension/extension.ts`         | Activation orchestrator -- wires all components together                                  |
| `src/shared/messages.ts`             | Webview message type definitions, factory functions, type guards                          |
| `src/shared/types.ts`                | JSON-RPC types, ChatMessage, ProcessStatus enums                                          |
| `src/webview/bridge.ts`              | Webview-side `acquireVsCodeApi()` wrapper, message bus                                    |
| `src/webview/hooks/useChat.ts`       | React reducer for chat state, streaming token accumulation                                |

---

## 2. ACP Protocol Details

### 2.1 Transport: ndjson over stdio

The `goose acp` subprocess is spawned with `stdio: ['pipe', 'pipe', 'pipe']`. Communication uses **newline-delimited JSON (ndjson)** -- each JSON-RPC message is a single line terminated by `\n`.

```
Extension stdin  ──write──>  goose acp stdin
Extension stdout <──read───  goose acp stdout
Extension stderr <──read───  goose acp stderr  (logged as warnings, not parsed as JSON-RPC)
```

The JSON-RPC client (`jsonRpcClient.ts`) implements ndjson framing:

- **Sending:** Each outgoing message is `JSON.stringify(message) + '\n'`.
- **Receiving:** Incoming data is buffered and split on `\n`. Incomplete lines are retained in a buffer until the next chunk arrives.

```typescript
// Sending (from jsonRpcClient.ts)
const requestLine = JSON.stringify(rpcRequest) + "\n";
stdin.write(requestLine);

// Receiving (from jsonRpcClient.ts)
buffer += chunk.toString("utf8");
const lines = buffer.split("\n");
buffer = lines.pop() ?? ""; // Keep incomplete last line
for (const line of lines) {
  const trimmed = line.trim();
  if (trimmed) handleLine(trimmed);
}
```

### 2.2 JSON-RPC 2.0 Message Formats

Three message types are defined in `src/shared/types.ts`:

#### Request (client -> goose)

```typescript
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number; // Auto-incrementing integer, starting at 1
  method: string;
  params?: unknown; // Omitted entirely if undefined
}
```

**Example on the wire:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientInfo": { "name": "vscode-goose", "version": "0.1.0" },
    "clientCapabilities": { "fs": { "readTextFile": false, "writeTextFile": false }, "terminal": false }
  }
}
```

#### Response (goose -> client)

```typescript
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number; // Matches the request id
  result?: unknown; // Present on success
  error?: {
    // Present on failure
    code: number;
    message: string;
    data?: unknown;
  };
}
```

#### Notification (goose -> client, no id, no response expected)

```typescript
interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string; // e.g., 'session/update'
  params?: unknown;
}
```

The client distinguishes responses from notifications by checking for the presence of `id`:

```typescript
if ("id" in message && message.id !== undefined) {
  // Response -- correlate with pending request
} else {
  // Notification -- dispatch to all registered callbacks
}
```

### 2.3 ACP Methods

#### 2.3.1 `initialize`

**Direction:** Client -> Goose (request/response)
**When:** Called once immediately after subprocess starts, before any session operations.

**Request params:**

```typescript
{
  protocolVersion: 1,
  clientInfo: {
    name: 'vscode-goose',
    version: '0.1.0'
  },
  clientCapabilities: {
    fs: { readTextFile: false, writeTextFile: false },
    terminal: false
  }
}
```

**Response result:**

```typescript
interface AcpInitializeResponse {
  protocolVersion: number;
  agentCapabilities?: {
    loadSession?: boolean; // Whether session/load is supported
    promptCapabilities?: {
      audio?: boolean;
      image?: boolean;
      embeddedContext?: boolean; // Whether embedded resource content is supported
    };
  };
  agentInfo?: {
    name?: string;
    version?: string;
  };
}
```

**Usage:** The extension parses `agentCapabilities` to determine:

- Whether `session/load` can be used for history replay (falls back to creating new sessions if not).
- Whether embedded context (inline file content) is supported in prompts.

#### 2.3.2 `session/new`

**Direction:** Client -> Goose (request/response)
**When:** Creating a new conversation session.

**Request params:**

```typescript
{
  cwd: string,          // Working directory (workspace folder path)
  mcpServers: []         // MCP server list (currently empty array)
}
```

**Response result:**

```typescript
{
  sessionId: string; // Unique session identifier assigned by goose
}
```

#### 2.3.3 `session/load`

**Direction:** Client -> Goose (request/response)
**When:** Restoring a previous session (replay its history).

**Request params:**

```typescript
{
  sessionId: string,     // Previously obtained session ID
  cwd: string,           // Working directory
  mcpServers: []
}
```

**Response result:**

```typescript
{
  success?: boolean
}
```

**Important behavior:** During the `session/load` request (before the response arrives), goose sends `session/update` notifications with `user_message_chunk` and `agent_message_chunk` sessionUpdate types to replay the full conversation history. The extension collects these into history messages. See [Section 5.2](#52-session-load-and-history-replay) for details.

#### 2.3.4 `session/prompt`

**Direction:** Client -> Goose (request/response)
**When:** Sending a user message to the agent.
**Timeout:** 30 seconds (default `DEFAULT_TIMEOUT_MS`).

**Request params:**

```typescript
{
  sessionId: string,
  prompt: AcpContentBlock[]    // Array of content blocks (see Section 2.4)
}
```

**Response result:**

```typescript
interface AcpPromptResponse {
  stopReason: "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";
}
```

**Important behavior:** This is a long-lived request. While it is pending, goose streams back `session/update` notifications with `agent_message_chunk` content. The response only arrives when the agent finishes generating (or is cancelled). The `stopReason` tells the extension how to finalize the message.

#### 2.3.5 `session/cancel`

**Direction:** Client -> Goose (notification, not request)
**When:** User clicks "Stop Generation".

**Notification params:**

```typescript
{
  sessionId: string;
}
```

This is sent as a JSON-RPC **notification** (no `id`, no response expected). It uses `client.notify()` rather than `client.request()`. After sending this, the pending `session/prompt` request eventually completes with `stopReason: 'cancelled'`.

### 2.4 Content Block Types

Content blocks are used in two contexts: (a) as part of `session/prompt` requests (client -> goose), and (b) inside `session/update` notifications (goose -> client).

#### Text Block

```typescript
{
  type: 'text',
  text: string
}
```

Used for: User message text, agent response text chunks, and inline file content with formatting.

#### Resource Link Block

```typescript
{
  type: 'resource_link',
  uri: string,           // e.g., 'file:///absolute/path/to/file.ts'
  name: string,          // Display name (usually filename)
  mimeType?: string      // e.g., 'text/typescript'
}
```

Used for: Referencing files that goose should read on its own. When sending a whole file as context, the extension sends a `resource_link` and lets goose read the file content.

#### Embedded Resource Block

```typescript
{
  type: 'resource',
  resource: {
    uri: string,
    text?: string,       // Text content of the resource
    blob?: string,       // Binary content (base64)
    mimeType?: string
  }
}
```

Used for: Goose returning file content in `session/update` notifications during history replay.

### 2.5 Session Update Notifications

All streaming and history data arrives via `session/update` notifications.

**Notification structure:**

```typescript
{
  jsonrpc: '2.0',
  method: 'session/update',
  params: {
    sessionId: string,
    update: {
      sessionUpdate: string,          // Discriminator (see below)
      content?: AcpContentBlock       // Optional content payload
    }
  }
}
```

**sessionUpdate types observed in the codebase:**

| sessionUpdate value   | Direction/Context                   | Description                                                                              |
| --------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `agent_message_chunk` | During `session/prompt` (streaming) | A chunk of the agent's response. `content` is typically `{ type: 'text', text: '...' }`. |
| `agent_message_chunk` | During `session/load` (replay)      | Replayed agent message from history.                                                     |
| `user_message_chunk`  | During `session/load` (replay)      | Replayed user message from history.                                                      |

During streaming, `agent_message_chunk` notifications arrive continuously with small text fragments that the extension forwards to the webview as `STREAM_TOKEN` messages.

During session load/replay, both `user_message_chunk` and `agent_message_chunk` are used to reconstruct the full conversation, and the content blocks can be `text`, `resource_link`, or `resource` type.

---

## 3. Webview <-> Extension Messaging

### 3.1 Message Format

All messages between the webview and extension use a typed envelope:

```typescript
interface WebviewMessage<T extends WebviewMessageType> {
  type: T; // Enum discriminator
  payload: WebviewMessagePayloads[T]; // Type-safe payload
}
```

### 3.2 Message Types (Complete Enumeration)

Defined in `src/shared/messages.ts`:

| Message Type           | Direction            | Payload                                                                 | Purpose                                                    |
| ---------------------- | -------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| `WEBVIEW_READY`        | Webview -> Extension | `{ version: string }`                                                   | Webview finished loading, ready for messages               |
| `STATUS_UPDATE`        | Extension -> Webview | `{ status: ProcessStatus, message?: string }`                           | Subprocess status change                                   |
| `GET_STATUS`           | Webview -> Extension | `{}`                                                                    | Request current subprocess status                          |
| `ERROR`                | Extension -> Webview | `{ title, message, action? }`                                           | Display error with optional action button                  |
| `SEND_MESSAGE`         | Webview -> Extension | `{ content, messageId, responseId, contextChips? }`                     | User sends a chat message                                  |
| `STREAM_TOKEN`         | Extension -> Webview | `{ messageId, token, done }`                                            | Streaming response token                                   |
| `GENERATION_COMPLETE`  | Extension -> Webview | `{ messageId }`                                                         | Agent finished generating                                  |
| `STOP_GENERATION`      | Webview -> Extension | `{}`                                                                    | User requests generation cancellation                      |
| `GENERATION_CANCELLED` | Extension -> Webview | `{ messageId }`                                                         | Confirms generation was cancelled                          |
| `CHAT_HISTORY`         | Extension -> Webview | `{ messages: ChatMessage[] }`                                           | Bulk set/replace chat messages                             |
| `OPEN_EXTERNAL_LINK`   | Webview -> Extension | `{ url }`                                                               | Open URL in system browser                                 |
| `CREATE_SESSION`       | Webview -> Extension | `{ workingDirectory? }`                                                 | Request new session creation                               |
| `SESSION_CREATED`      | Extension -> Webview | `{ session: SessionEntry }`                                             | Confirms new session, triggers `CLEAR_MESSAGES` in reducer |
| `GET_SESSIONS`         | Webview -> Extension | `{}`                                                                    | Request session list                                       |
| `SESSIONS_LIST`        | Extension -> Webview | `{ sessions, activeSessionId }`                                         | Full session list with active indicator                    |
| `SELECT_SESSION`       | Webview -> Extension | `{ sessionId }`                                                         | Switch to different session                                |
| `SESSION_LOADED`       | Extension -> Webview | `{ sessionId, historyUnavailable? }`                                    | Session switch completed                                   |
| `HISTORY_MESSAGE`      | Extension -> Webview | `{ message: ChatMessage, isReplay: true }`                              | Single message during history replay                       |
| `HISTORY_COMPLETE`     | Extension -> Webview | `{ sessionId, messageCount }`                                           | History replay finished                                    |
| `VERSION_STATUS`       | Extension -> Webview | `{ status, detectedVersion?, minimumVersion, installUrl?, updateUrl? }` | Binary version compatibility status                        |
| `ADD_CONTEXT_CHIP`     | Extension -> Webview | `{ chip: ContextChip }`                                                 | Add file/selection context chip to input                   |
| `FILE_SEARCH`          | Webview -> Extension | `{ query }`                                                             | Search workspace files (for @ mentions)                    |
| `SEARCH_RESULTS`       | Extension -> Webview | `{ results: FileSearchResult[] }`                                       | File search results                                        |
| `FOCUS_CHAT_INPUT`     | Extension -> Webview | `{}`                                                                    | Focus the chat input field                                 |

### 3.3 The Bridge Pattern

The webview side uses a bridge module (`src/webview/bridge.ts`) that wraps VS Code's `acquireVsCodeApi()`:

```typescript
// Initialization (called once when webview mounts)
function initializeBridge(): void {
  window.addEventListener('message', handleIncomingMessage);
  postMessage(createWebviewReadyMessage(EXTENSION_VERSION));
}

// Sending messages to extension
function postMessage(message: AnyWebviewMessage): void {
  const api = getVsCodeApi();
  api.postMessage(message);
}

// Subscribing to messages from extension
function onMessage(handler: MessageHandler): () => void {
  messageHandlers.push(handler);
  return () => { /* unsubscribe */ };
}

// Persisting state across webview visibility changes
function getState<T>(): T | undefined { ... }
function setState<T>(state: T): void { ... }
```

**Extension side** (`src/extension/webviewProvider.ts`) mirrors this:

```typescript
// Send to webview (with queuing if not ready)
postMessage(message: AnyWebviewMessage): void

// Receive from webview
onMessage(callback: MessageCallback): vscode.Disposable

// Webview ready handshake
waitForReady(): Promise<void>
```

### 3.4 Ready-Signal Handshake and Message Queuing

The webview provider implements a **message queue** to handle timing issues:

1. When the webview is first created, `isReady = false`.
2. Messages sent before the webview is ready are queued in `messageQueue[]`.
3. When the webview sends `WEBVIEW_READY`, the queue is flushed and `isReady = true`.
4. If the webview is disposed and re-created (e.g., tab hidden/shown), `isReady` resets to `false`.
5. On reconnect, the extension re-sends the last known `ProcessStatus` and `VersionStatus`.

```
Webview loads
  |
  +--> sends WEBVIEW_READY { version: '2.0.0' }
  |
Extension receives WEBVIEW_READY
  |
  +--> sets isReady = true
  +--> flushes queued messages
  +--> re-sends last known status
```

### 3.5 End-to-End Message Flow: User Sends a Message

```
1. User types and clicks Send
   |
2. useChat.sendMessage() dispatches:
   - ADD_USER_MESSAGE (local state)
   - START_GENERATION (creates placeholder assistant message)
   |
3. bridge.postMessage(SEND_MESSAGE { content, messageId, responseId, contextChips? })
   |
4. Extension receives SEND_MESSAGE in setupAcpCommunication()
   |
5. Extension calls buildPromptBlocks() to construct content blocks:
   - For each context chip with range: reads file lines, creates text block
   - For each context chip without range: creates resource_link block
   - Adds user text as final text block
   |
6. Extension sends JSON-RPC request: session/prompt { sessionId, prompt: [...blocks] }
   |
7. goose processes and streams back session/update notifications:
   { method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'chunk...' } } } }
   |
8. Extension notification handler extracts text, sends to webview:
   STREAM_TOKEN { messageId: responseId, token: 'chunk...', done: false }
   |
9. useChat reducer: STREAM_TOKEN action appends token to assistant message content
   |
10. session/prompt response arrives with stopReason
    |
11. Extension sends GENERATION_COMPLETE or GENERATION_CANCELLED
    |
12. useChat reducer: COMPLETE_GENERATION sets message status to COMPLETE
```

---

## 4. Streaming Architecture

### 4.1 How Streaming Tokens Flow

During an active `session/prompt` request, goose sends `session/update` notifications containing `agent_message_chunk` updates. The extension's notification handler in `setupAcpCommunication()` processes these:

```typescript
client.onNotification((notification: JsonRpcNotification) => {
  const params = notification.params as AcpSessionUpdateParams;

  if (notification.method === "session/update" && params?.update) {
    const { sessionUpdate, content } = params.update;

    if (sessionUpdate === "agent_message_chunk" && currentResponseId && content?.type === "text") {
      provider.postMessage(createStreamTokenMessage(currentResponseId, content.text, false));
    }
  }
});
```

**Important observations:**

- There is **no batching or throttling** of stream tokens in the current implementation. Each `session/update` notification is immediately forwarded as a `STREAM_TOKEN` message to the webview.
- The `done` field on `STREAM_TOKEN` is always set to `false` during streaming; completion is signaled separately via `GENERATION_COMPLETE`.
- Only `text`-type content blocks are forwarded during streaming. Resource links and embedded resources that may appear during streaming are not handled.

### 4.2 The useChat Reducer

The webview manages chat state through a React reducer (`src/webview/hooks/useChat.ts`):

**State shape:**

```typescript
interface ChatState {
  messages: ChatMessage[];
  isGenerating: boolean;
  currentResponseId: string | null;
  inputValue: string;
  focusedIndex: number | null;
}
```

**Actions and state transitions:**

| Action                | Effect                                                                     |
| --------------------- | -------------------------------------------------------------------------- |
| `ADD_USER_MESSAGE`    | Appends user message, clears input                                         |
| `START_GENERATION`    | Appends empty assistant message (status=STREAMING), sets isGenerating=true |
| `STREAM_TOKEN`        | Finds message by ID, **appends** token to its `content` string             |
| `COMPLETE_GENERATION` | Sets message status to COMPLETE, clears isGenerating                       |
| `CANCEL_GENERATION`   | Sets message status to CANCELLED, clears isGenerating                      |
| `SET_MESSAGES`        | Replaces entire message array (used for CHAT_HISTORY)                      |
| `ADD_HISTORY_MESSAGE` | Appends a single replayed message (used during session/load)               |
| `CLEAR_MESSAGES`      | Resets messages array (triggered by SESSION_CREATED)                       |
| `ADD_ERROR_MESSAGE`   | Appends error message, clears isGenerating                                 |

### 4.3 Token Accumulation

Token accumulation is handled entirely through string concatenation in the reducer:

```typescript
case 'STREAM_TOKEN':
  return {
    ...state,
    messages: state.messages.map(msg =>
      msg.id === action.payload.messageId
        ? { ...msg, content: msg.content + action.payload.token }
        : msg
    ),
  };
```

Each `STREAM_TOKEN` action triggers a full state update (new messages array with the target message's content extended). This is simple but means every token causes a re-render of the message list.

### 4.4 Message Finalization

When the `session/prompt` response returns:

- **`stopReason: 'end_turn'`** (or `'max_tokens'`, `'max_turn_requests'`, `'refusal'`): Extension sends `GENERATION_COMPLETE`.
- **`stopReason: 'cancelled'`**: Extension sends `GENERATION_CANCELLED`.

If the request fails entirely (JSON-RPC error or timeout), the extension sends both an `ERROR` message and a `GENERATION_CANCELLED` to reset the UI state.

### 4.5 Cancellation Flow

```
1. User clicks Stop
   |
2. useChat.stopGeneration() -> postMessage(STOP_GENERATION)
   |
3. Extension receives STOP_GENERATION
   |
4. Extension sends JSON-RPC notification: session/cancel { sessionId }
   |
5. goose stops generation
   |
6. Pending session/prompt response arrives with stopReason: 'cancelled'
   |
7. Extension sends GENERATION_CANCELLED { messageId }
   |
8. useChat reducer: CANCEL_GENERATION sets status to CANCELLED
```

---

## 5. Session Management

### 5.1 Session Data Model

Sessions are stored in VS Code's `globalState` (persistent across restarts):

```typescript
interface SessionEntry {
  sessionId: string; // Assigned by goose via session/new
  title: string; // Auto-generated from first message (max 50 chars)
  cwd: string; // Workspace directory at creation time
  createdAt: string; // ISO 8601 timestamp
}

interface SessionStorageData {
  schemaVersion: 1;
  activeSessionId: string | null;
  sessions: SessionEntry[];
}
```

Storage keys:

- `goose.sessions.v1` -- Session list
- `goose.activeSession` -- Active session ID

**Critical design point:** The extension stores only **metadata** locally. All conversation content lives on the goose side. Session history is reconstructed via `session/load` replay, not read from local storage.

### 5.2 Session Load and History Replay

When loading a previous session, the following sequence occurs:

```
1. Extension sends: session/load { sessionId, cwd, mcpServers: [] }
   |
2. goose replays history as session/update notifications:
   |
   +-- { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'user message 1' } }
   +-- { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'agent reply 1' } }
   +-- { sessionUpdate: 'user_message_chunk', content: { type: 'resource_link', uri: '...', name: '...' } }
   +-- { sessionUpdate: 'agent_message_chunk', content: { type: 'resource', resource: { uri: '...', text: '...' } } }
   +-- ... more messages ...
   |
3. session/load response arrives: { success: true }
```

The session manager registers a temporary notification handler that:

- Maps `user_message_chunk` to `MessageRole.USER`
- Maps `agent_message_chunk` to `MessageRole.ASSISTANT`
- Handles three content types:
  - **text**: Creates a message with the text as content
  - **resource_link**: Creates a message with a `context` array containing `{ filePath, fileName }`
  - **resource**: Creates a message with a `context` array containing `{ filePath, fileName, content }`
- Each replayed message is dispatched through `historyMessageCallbacks` and forwarded to the webview as `HISTORY_MESSAGE`
- When the response arrives, `HISTORY_COMPLETE` is sent

The `isLoadingSession` flag prevents replay notifications from being processed after the load completes.

### 5.3 Session Creation Flow

```
1. Extension calls: session/new { cwd, mcpServers: [] }
   |
2. goose responds: { sessionId: 'abc123' }
   |
3. Extension creates SessionEntry and stores locally
   |
4. Extension sends to webview: SESSION_CREATED { session }
   |
5. Webview useChat reducer: CLEAR_MESSAGES (starts fresh)
```

### 5.4 Activation Session Restoration

On extension activation:

1. After `initialize`, check if there is an `activeSessionId` in storage.
2. If yes and `loadSession` capability is available, call `session/load` to restore.
3. If `session/load` fails, fall back to creating a new session via `session/new`.
4. If no active session exists, create a new one.

### 5.5 Session Title Generation

The session title is auto-generated from the first user message:

- Truncated to 50 characters
- Breaks at word boundaries when possible
- Appended with `...` if truncated
- Defaults to `'New Session'` if empty

---

## 6. Key Considerations for Integration

### 6.1 Binary Discovery

The extension locates the `goose` binary through a priority-ordered search (in `src/extension/binaryDiscovery.ts`):

1. **User-configured path** (`goose.binaryPath` setting) -- checked first
2. **PATH environment variable** -- searches each directory for `goose` (or `goose.exe` on Windows)
3. **Platform-specific paths:**
   - **macOS:** `/Applications/Goose.app/Contents/MacOS/goose`, `~/.local/bin/goose`, `/usr/local/bin/goose`, `/opt/homebrew/bin/goose`
   - **Linux:** `~/.local/bin/goose`, `/usr/local/bin/goose`, `/usr/bin/goose`, `/usr/share/goose/bin/goose`
   - **Windows:** `%LOCALAPPDATA%\Goose\goose.exe`, `%PROGRAMFILES%\Goose\goose.exe`

Paths with `~` are expanded to the user's home directory. Windows `%VAR%` patterns are expanded from environment variables. Each candidate is checked for existence and execute permission via `fs.accessSync(path, fs.constants.X_OK)`.

### 6.2 Version Checking

Before spawning the subprocess, the extension runs `goose --version` and parses the output:

- **Minimum required version:** `1.16.0`
- **Timeout:** 5 seconds
- **Supported formats:** `goose 1.16.0`, `v1.16.0`, `1.16.0`, `goose version 1.16.0`, `Goose 1.16.0-beta`
- **Comparison:** Semantic versioning (major.minor.patch)

If the version check fails, the extension sends a `VERSION_STATUS` message to the webview with status `blocked_missing` or `blocked_outdated`, and does **not** spawn the subprocess. The webview displays an appropriate error with install/update links.

### 6.3 Subprocess Lifecycle and Error Handling

**Process states** (from `ProcessStatus` enum):

- `stopped` -- Not running
- `starting` -- Spawn in progress
- `running` -- Active and healthy
- `error` -- Crashed or failed to start

**Spawn:** `spawn(binaryPath, ['acp'], { stdio: ['pipe', 'pipe', 'pipe'], cwd: workingDirectory })`

**Crash detection:** If the process exits while status is `RUNNING`, this is treated as a crash:

```typescript
if (status === ProcessStatus.RUNNING) {
  lastError = createSubprocessCrashError(code, signal);
  setStatus(ProcessStatus.ERROR);
}
```

**Graceful shutdown:** SIGTERM with a 5-second timeout, followed by SIGKILL if the process has not exited.

**Error recovery:** When the subprocess crashes:

1. The `JsonRpcClient` is disposed (all pending requests rejected with "Client disposed").
2. Status is set to `ERROR`.
3. A VS Code warning notification tells the user to use "Goose: Restart".
4. The restart command (`goose.restart`) stops the current process, re-discovers the binary, and starts a new subprocess.

**Fallback mock mode:** If the subprocess fails to start or session initialization fails, the extension falls back to a **mock streaming mode** that sends canned responses. This is useful for UI development but should not be relied upon in production.

### 6.4 JSON-RPC Client Error Handling

**Request timeout:** Each request has a 30-second timeout (`DEFAULT_TIMEOUT_MS`). On timeout, the pending request is rejected with a `JsonRpcTimeoutError`.

**Client disposal:** When the client is disposed (subprocess stop or crash), all pending requests are immediately rejected with code `-32000` ("Client disposed").

**Write errors:** If writing to stdin fails, the request is immediately rejected.

**Parse errors:** Malformed JSON from stdout is logged but does not crash the client. Individual lines that fail to parse are skipped.

**Error types** (discriminated union via `_tag`):

```typescript
type GooseError =
  | BinaryNotFoundError // Binary not found on system
  | SubprocessSpawnError // Failed to spawn process
  | SubprocessCrashError // Process exited unexpectedly
  | JsonRpcParseError // Invalid JSON from goose
  | JsonRpcTimeoutError // Request timed out
  | JsonRpcError // JSON-RPC error response
  | VersionMismatchError; // Version below minimum
```

### 6.5 Permission Requests and Tool Calls

In the current codebase, there is **no explicit handling of `request_permission`** notifications or tool call visibility. The `session/update` notification handler only processes `agent_message_chunk` (and `user_message_chunk` during replay). Any other `sessionUpdate` types (such as tool invocations or permission requests) are silently ignored.

If goose sends tool call information or permission requests via different `sessionUpdate` types, an integrator would need to:

1. Add handlers for additional `sessionUpdate` values in the notification callback.
2. Define new webview message types to communicate these to the UI.
3. Implement UI for displaying tool calls and approving/denying permission requests.

### 6.6 Context Chips (File References)

The extension supports attaching file context to messages:

**Whole file reference** (goose reads the file):

```typescript
{ type: 'resource_link', uri: 'file:///path/to/file.ts', name: 'file.ts', mimeType: 'text/typescript' }
```

**Line range selection** (extension reads and inlines the content):

````typescript
{ type: 'text', text: 'File: /path/to/file.ts:10-25\n```\n...content...\n```' }
````

The decision between these is made in `buildPromptBlocks()`:

- If a chip has a `range`, the extension reads the specific lines and sends them as formatted text.
- If a chip has no range (whole file), it sends a `resource_link` for goose to read.

### 6.7 fp-ts Usage

The codebase uses fp-ts for functional error handling:

- `Either<Error, Value>` for synchronous operations (binary discovery, client access)
- `TaskEither<Error, Value>` for async operations (subprocess start, JSON-RPC requests, session operations)
- `pipe()` for function composition

This means most operations return `Either` or `TaskEither` rather than throwing exceptions. To invoke a `TaskEither`, call it as a function: `await someTaskEither()` returns an `Either`.

### 6.8 Integration Checklist

For a developer building an ACP client:

1. **Binary discovery:** Locate the `goose` binary (or accept a configured path).
2. **Version check:** Run `goose --version` and verify >= 1.16.0.
3. **Spawn subprocess:** `goose acp` with piped stdio.
4. **Create JSON-RPC client:** Implement ndjson framing over stdin/stdout.
5. **Send `initialize`:** Include `protocolVersion: 1` and `clientInfo`. Parse `agentCapabilities` from the response.
6. **Create session:** Call `session/new` with `cwd`.
7. **Register notification handler:** Listen for `session/update` notifications to receive streaming tokens.
8. **Send prompts:** Call `session/prompt` with content blocks. Handle the long-lived request while processing streamed notifications.
9. **Handle cancellation:** Send `session/cancel` notification to abort generation.
10. **Handle session restoration:** If `loadSession` capability is true, use `session/load` to replay history on reconnect.
11. **Handle subprocess crashes:** Detect exit events, dispose the client, provide restart capability.
12. **Graceful shutdown:** Send SIGTERM, wait up to 5 seconds, then SIGKILL.
