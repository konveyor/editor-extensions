# Chat Message Flow: How Messages Get to Webview

Chat messages use a **hybrid approach** - they're stored in the extension store but use **on-demand fetching** instead of automatic sync bridges. This prevents performance issues when there are 50,000+ messages.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                  VSCODE EXTENSION HOST (Node.js)                │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Various Code Paths Add Messages                         │  │
│  │  (processMessage.ts, queueManager.ts, etc.)              │  │
│  └────────────────┬─────────────────────────────────────────┘  │
│                   │                                             │
│                   │ Calls legacy mutateChatMessages()           │
│                   ▼                                             │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  mutateChatMessages (extension.ts:132)                   │  │
│  │  DEPRECATED wrapper - phase out in progress              │  │
│  │                                                           │  │
│  │  1. Updates legacy state (this.data)                     │  │
│  │  2. Syncs to Zustand store:                              │  │
│  │     extensionStore.getState().setChatMessages(messages)  │  │
│  │  3. Manual broadcast for streaming updates:              │  │
│  │     type: "CHAT_MESSAGE_STREAMING_UPDATE"                │  │
│  └────────────────┬─────────────────────────────────────────┘  │
│                   │                                             │
│                   │ Updates store state                         │
│                   ▼                                             │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Extension Store (extensionStore.ts)                     │  │
│  │                                                           │  │
│  │  State:                                                   │  │
│  │    chatMessages: ChatMessage[] = [...]                   │  │
│  │                                                           │  │
│  │  Legacy Actions (simple setters):                        │  │
│  │    • addChatMessage(message)                             │  │
│  │    • setChatMessages(messages)                           │  │
│  │    • clearChatMessages()                                 │  │
│  │                                                           │  │
│  │  Domain Actions (chat.ts):                               │  │
│  │    • chat.addMessage(message)                            │  │
│  │    • chat.updateStreamingMessage(index, message)         │  │
│  │    • chat.setAll(messages)                               │  │
│  │    • chat.clearAll()                                     │  │
│  │    • chat.getCount()                                     │  │
│  │    • chat.getSlice(offset, limit)                        │  │
│  │                                                           │  │
│  │  ⚠️  NO SYNC BRIDGE for chat messages!                   │  │
│  │     (Would be too expensive - 50k+ messages)             │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│                   ┌─────────────────────────────────┐           │
│                   │  Two Types of Messages Sent:   │           │
│                   └─────────────────────────────────┘           │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  1. STREAMING UPDATES (Manual Broadcast)                 │  │
│  │                                                           │  │
│  │  When: Last message content changes (streaming LLM)      │  │
│  │  How: mutateChatMessages detects streaming update        │  │
│  │       and manually broadcasts                            │  │
│  │                                                           │  │
│  │  Message:                                                 │  │
│  │  {                                                        │  │
│  │    type: "CHAT_MESSAGE_STREAMING_UPDATE",                │  │
│  │    message: ChatMessage,                                 │  │
│  │    messageIndex: number,                                 │  │
│  │    timestamp: ISO string                                 │  │
│  │  }                                                        │  │
│  │                                                           │  │
│  │  See: extension.ts:148-159                               │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  2. ON-DEMAND FETCH (Request/Response)                   │  │
│  │                                                           │  │
│  │  When: Webview opens chat panel or scrolls               │  │
│  │  How: Webview sends GET_CHAT_MESSAGES request            │  │
│  │                                                           │  │
│  │  Handler: webviewMessageHandler.ts:382                   │  │
│  │                                                           │  │
│  │  [GET_CHAT_MESSAGES]: async ({ offset, limit }, state) =>│  │
│  │    const chatMessages =                                  │  │
│  │      extensionStore.getState().chatMessages;             │  │
│  │    const slice = chatMessages.slice(offset, offset+limit)│  │
│  │                                                           │  │
│  │    provider.sendMessageToWebview({                       │  │
│  │      type: "CHAT_MESSAGES_RESPONSE",                     │  │
│  │      chatMessages: slice,                                │  │
│  │      offset, limit, totalCount, hasMore                  │  │
│  │    });                                                    │  │
│  │  }                                                        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ VSCode Message Passing
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    WEBVIEW (Browser/React)                      │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Message Handler (useVSCodeMessageHandler.ts)            │  │
│  │                                                           │  │
│  │  Handles two message types:                              │  │
│  │                                                           │  │
│  │  1. CHAT_MESSAGE_STREAMING_UPDATE (lines 80-116)         │  │
│  │     - Throttled to 100ms to prevent render death spiral  │  │
│  │     - Updates single message at index                    │  │
│  │     - Used for streaming LLM responses                   │  │
│  │                                                           │  │
│  │  2. CHAT_MESSAGES_UPDATE (lines 119-133)                 │  │
│  │     - Replaces entire message array                      │  │
│  │     - Applies MAX_CHAT_MESSAGES limit (50,000)           │  │
│  │     - Drops oldest messages if over limit                │  │
│  │                                                           │  │
│  └────────────────┬─────────────────────────────────────────┘  │
│                   │                                             │
│                   │ Updates React store                         │
│                   ▼                                             │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  React Zustand Store (store.ts)                          │  │
│  │                                                           │  │
│  │  State:                                                   │  │
│  │    chatMessages: ChatMessage[] = []                      │  │
│  │                                                           │  │
│  │  Actions:                                                 │  │
│  │    • addChatMessage(message)                             │  │
│  │       - Pushes message                                   │  │
│  │       - Auto-trims if > MAX_CHAT_MESSAGES                │  │
│  │                                                           │  │
│  │    • setChatMessages(messages)                           │  │
│  │       - Replaces entire array                            │  │
│  │                                                           │  │
│  │    • clearChatMessages()                                 │  │
│  │       - Empties array                                    │  │
│  └────────────────┬─────────────────────────────────────────┘  │
│                   │                                             │
│                   │ React subscriptions                         │
│                   ▼                                             │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Chat Components                                          │  │
│  │                                                           │  │
│  │  const chatMessages = useExtensionStore(s => s.chatMessages)│
│  │                                                           │  │
│  │  // Or fetch on-demand:                                  │  │
│  │  const fetchMessages = () => {                           │  │
│  │    vscode.postMessage({                                  │  │
│  │      type: 'GET_CHAT_MESSAGES',                          │  │
│  │      payload: { offset: 0, limit: 100 }                  │  │
│  │    });                                                    │  │
│  │  };                                                       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Flow Scenarios

### Scenario 1: LLM Streaming Response

**What happens when an LLM streams a response?**

1. **LLM Provider sends token**

   ```typescript
   // In processMessage.ts or similar
   state.mutateChatMessages((draft) => {
     // Update the last message with new content
     const lastMsg = draft.chatMessages[draft.chatMessages.length - 1];
     lastMsg.value.message += newToken;
   });
   ```

2. **mutateChatMessages detects streaming**

   ```typescript
   // extension.ts:144-159
   const isStreamingUpdate = data.chatMessages.length === oldMessages.length && data.chatMessages.length > 0;

   if (isStreamingUpdate) {
     // Manual broadcast for streaming
     provider.sendMessageToWebview({
       type: "CHAT_MESSAGE_STREAMING_UPDATE",
       message: lastMessage,
       messageIndex: data.chatMessages.length - 1,
       timestamp: new Date().toISOString(),
     });
   }
   ```

3. **Webview receives CHAT_MESSAGE_STREAMING_UPDATE**

   ```typescript
   // useVSCodeMessageHandler.ts:80-116
   case "CHAT_MESSAGE_STREAMING_UPDATE": {
     // Throttle to 100ms to prevent excessive re-renders
     pendingStreamingUpdateRef.current = {
       messageIndex: payload.messageIndex,
       message: payload.message,
     };

     if (!throttleTimerRef.current) {
       throttleTimerRef.current = setTimeout(() => {
         // Update single message at index
         const updatedMessages = [...currentMessages];
         updatedMessages[index] = {
           ...currentMessages[index],
           ...pending.message,
           value: {
             ...currentMessages[index]?.value,
             ...pending.message.value,
           },
         };
         store.setChatMessages(updatedMessages);
       }, 100); // 100ms throttle
     }
   }
   ```

4. **React components re-render**
   - Only components subscribed to `chatMessages` re-render
   - Update is throttled to max 10 updates/second

### Scenario 2: User Opens Chat Panel

**What happens when a user opens the chat panel?**

1. **Chat component mounts**

   ```typescript
   // In Chat.tsx or similar
   useEffect(() => {
     // Request initial batch of messages
     vscode.postMessage({
       type: "GET_CHAT_MESSAGES",
       payload: { offset: 0, limit: 100 },
     });
   }, []);
   ```

2. **Extension receives GET_CHAT_MESSAGES**

   ```typescript
   // webviewMessageHandler.ts:382-406
   [GET_CHAT_MESSAGES]: async ({ offset = 0, limit = 100 }, state) => {
     const chatMessages = extensionStore.getState().chatMessages;
     const totalCount = chatMessages.length;
     const slice = chatMessages.slice(offset, offset + limit);

     state.webviewProviders.forEach((provider) => {
       provider.sendMessageToWebview({
         type: "CHAT_MESSAGES_RESPONSE",
         chatMessages: slice,
         offset,
         limit,
         totalCount,
         hasMore: offset + limit < totalCount,
       });
     });
   }
   ```

3. **Webview receives CHAT_MESSAGES_RESPONSE**

   ```typescript
   // useVSCodeMessageHandler.ts:119-133
   case "CHAT_MESSAGES_UPDATE": {
     const limitedMessages =
       payload.chatMessages.length > MAX_CHAT_MESSAGES
         ? payload.chatMessages.slice(-MAX_CHAT_MESSAGES)
         : payload.chatMessages;

     store.setChatMessages(limitedMessages);
   }
   ```

4. **User scrolls to load more**
   ```typescript
   // In Chat.tsx infinite scroll handler
   const loadMore = () => {
     vscode.postMessage({
       type: "GET_CHAT_MESSAGES",
       payload: {
         offset: chatMessages.length,
         limit: 100,
       },
     });
   };
   ```

### Scenario 3: New Message Added

**What happens when a new message is added (not streaming)?**

1. **Code adds message**

   ```typescript
   // In queueManager.ts:160 or similar
   state.mutateChatMessages((draft) => {
     draft.chatMessages.push({
       kind: ChatMessageType.String,
       messageToken: `msg-${Date.now()}`,
       value: { message: "Hello!" },
       timestamp: new Date().toISOString(),
     });
   });
   ```

2. **mutateChatMessages updates store**

   ```typescript
   // extension.ts:132-162
   const mutateChatMessages = (recipe) => {
     const data = produce(getData(), recipe);
     this.data = data;

     // Update Zustand store
     extensionStore.getState().setChatMessages(data.chatMessages);

     // Check if streaming (array length changed = not streaming)
     const isStreamingUpdate = data.chatMessages.length === oldMessages.length;

     if (!isStreamingUpdate) {
       // For new messages, no automatic broadcast
       // Webview must request via GET_CHAT_MESSAGES
     }
   };
   ```

3. **Webview doesn't receive update automatically**
   - This is by design to prevent broadcasting 50k+ messages
   - If webview needs to know about new message, it must poll or request

4. **Alternative: Notification message**
   ```typescript
   // Could send lightweight notification
   provider.sendMessageToWebview({
     type: "CHAT_MESSAGE_COUNT_UPDATE",
     count: chatMessages.length,
     latestMessageToken: lastMessage.messageToken,
   });
   // Webview can then decide to fetch if needed
   ```

## Current State vs Ideal State

### Current Implementation (Hybrid)

✅ **Good:**

- Streaming updates work well with throttling
- On-demand fetching prevents broadcasting 50k messages
- Store keeps messages in extension host

⚠️ **Needs Improvement:**

- Still using legacy `mutateChatMessages()` wrapper
- Manual broadcast for streaming is fragile
- No clear notification when new messages are added (non-streaming)

### Future Ideal Implementation

**Phase 1: Migrate to Domain Actions**

```typescript
// Replace mutateChatMessages calls with:
extensionStore.getState().chat.addMessage(message);
extensionStore.getState().chat.updateStreamingMessage(index, content);
```

**Phase 2: Add Message Count Sync Bridge**

```typescript
// In initializeSyncBridges.ts
manager.createBridge({
  selector: (state) => ({
    chatMessageCount: state.chatMessages.length,
    latestMessageToken: state.chatMessages[state.chatMessages.length - 1]?.messageToken,
  }),
  messageType: "CHAT_METADATA_UPDATE",
  debugName: "chatMetadata",
});
```

This way:

- Webview knows when new messages arrive (lightweight update)
- Can decide whether to fetch latest messages
- Streaming updates still manual (special case)
- Keeps bulk message data out of sync bridges

## Code Locations

### Extension (VSCode Core)

**Message Creation:**

- [processMessage.ts](../vscode/core/src/utilities/ModifiedFiles/processMessage.ts) - Main message processor
- [queueManager.ts](../vscode/core/src/utilities/ModifiedFiles/queueManager.ts) - Queue error messages
- [solutionWorkflowOrchestrator.ts](../vscode/core/src/solutionWorkflowOrchestrator.ts) - Solution workflow messages

**Store & Actions:**

- [extensionStore.ts:343-357](../vscode/core/src/store/extensionStore.ts#L343-L357) - Legacy chat actions
- [domains/chat.ts](../vscode/core/src/store/domains/chat.ts) - Domain actions (new pattern)
- [extension.ts:132-162](../vscode/core/src/extension.ts#L132-L162) - mutateChatMessages wrapper

**Message Handlers:**

- [webviewMessageHandler.ts:382-406](../vscode/core/src/webviewMessageHandler.ts#L382-L406) - GET_CHAT_MESSAGES handler

### Webview (React)

**Message Handling:**

- [useVSCodeMessageHandler.ts:80-133](../webview-ui/src/hooks/useVSCodeMessageHandler.ts#L80-L133) - Streaming & full updates

**Store:**

- [store.ts:228-251](../webview-ui/src/store/store.ts#L228-L251) - Chat actions with auto-trimming

## Performance Considerations

### Why No Sync Bridge?

**Problem:**

```typescript
// ❌ This would be terrible:
manager.createBridge({
  selector: (state) => ({
    chatMessages: state.chatMessages, // 50,000+ messages!
  }),
  messageType: "CHAT_MESSAGES_UPDATE",
});
```

**Issues:**

1. **Massive payload**: 50k messages × average 500 bytes = 25MB
2. **Frequent updates**: Every new message triggers full broadcast
3. **Serialization cost**: JSON.stringify(50k messages) is expensive
4. **Network overhead**: 25MB over IPC on every update
5. **Memory spikes**: Webview must process entire array every time

### Why Streaming is Manual

**Streaming updates happen frequently:**

- LLM generates tokens every 50-100ms
- Without throttling = 10-20 updates/second
- With Zustand subscriptions = 10-20 re-renders/second
- Result: UI freezes, browser struggles

**Solution:**

- Manual broadcast with custom throttling (100ms)
- Webview handler batches updates
- Max 10 updates/second = smooth UX

### Memory Limits

Both extension and webview enforce `MAX_CHAT_MESSAGES = 50,000`:

**Extension:**

```typescript
// Could add in chat.addMessage:
if (state.chatMessages.length > MAX_CHAT_MESSAGES) {
  state.chatMessages = state.chatMessages.slice(-MAX_CHAT_MESSAGES);
}
```

**Webview:**

```typescript
// store.ts:228-241
addChatMessage: (message) =>
  set((state) => {
    state.chatMessages.push(message);

    if (state.chatMessages.length > MAX_CHAT_MESSAGES) {
      const droppedCount = state.chatMessages.length - MAX_CHAT_MESSAGES;
      state.chatMessages = state.chatMessages.slice(-MAX_CHAT_MESSAGES);
      console.warn(`Dropping ${droppedCount} oldest messages`);
    }
  }),
```

## Migration TODO

- [ ] Replace all `mutateChatMessages` calls with `chat.addMessage()` / `chat.updateStreamingMessage()`
- [ ] Add lightweight sync bridge for chat metadata (count, latest token)
- [ ] Implement pagination UI in chat components
- [ ] Add virtual scrolling for large message lists
- [ ] Consider IndexedDB for message persistence in webview
- [ ] Add chat message search/filtering

## Related Documentation

- [Zustand Architecture](./ZUSTAND_ARCHITECTURE.md)
- [Domain Driven Store Redesign](./DOMAIN_DRIVEN_STORE_REDESIGN.md)
- [Modular Store Architecture](./MODULAR_STORE_ARCHITECTURE.md)
