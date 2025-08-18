# Vertical Diff System Debug Checklist

## Summary of Changes

We've integrated Continue's vertical diff system to display:

- **Deletions**: Blank lines with gray ghost text showing removed content
- **Additions**: Green background highlighting for new lines
- **CodeLens**: Accept/Reject buttons at diff blocks

## Key Components

### 1. Core System

- ✅ `VerticalDiffManager` - Manages diff handlers per file
- ✅ `VerticalDiffHandler` - Applies diffs to specific file
- ✅ `StaticDiffAdapter` - Converts static diffs to streaming format
- ✅ `Decoration Managers` - Apply visual decorations

### 2. Integration Points

- ✅ `extension.ts` - Initializes diff system on activation
- ✅ `commands.ts` - Updated to use new diff system
- ✅ `webviewMessageHandler.ts` - Routes diff messages to commands
- ✅ `extensionState.ts` - Stores manager instances

### 3. Protocol/Messaging

- ✅ `MinimalWebviewProtocol` - Simplified protocol (no Continue dependencies)
- ❌ Full Continue protocol - NOT NEEDED

## Debug Logging Added

We've added console logging at key points:

1. **StaticDiffAdapter**
   - `[StaticDiffAdapter] Starting streamDiffLines`
   - Shows when diff processing begins

2. **VerticalDiffManager**
   - `[VerticalDiffManager] streamDiffLines - active editor`
   - `[VerticalDiffManager] Creating new handler`
   - `[VerticalDiffManager] Status update`

3. **VerticalDiffHandler**
   - `[Handler] Queued diff line`
   - `[Handler] Processing queue`
   - `[Handler] Handling diff line`
   - `[Handler] insertDeletionBuffer called`
   - `[Handler] Adding removed line decorations`

4. **Decoration Managers**
   - `[AddedLineDecoration] Adding lines`
   - `[RemovedLineDecoration] Adding ghost text`
   - `[RemovedLineDecoration] Applying decorations`

## Testing Flow

1. Click "View with Decorations" in webview
2. Check VS Code Developer Console for logs
3. Expected log sequence:
   ```
   [StaticDiffAdapter] Starting streamDiffLines
   [VerticalDiffManager] Creating new handler
   [Handler] Queued diff line: old
   [Handler] Queued diff line: new
   [Handler] Processing queue
   [Handler] Handling diff line: type=old
   [Handler] insertDeletionBuffer called
   [RemovedLineDecoration] Adding ghost text
   [Handler] Handling diff line: type=new
   [AddedLineDecoration] Adding lines
   ```

## Common Issues & Solutions

### Issue: No decorations appear

**Check:**

1. Is the correct file the active editor?
2. Are there console errors?
3. Do logs show handler creation?

### Issue: Handler not created

**Check:**

1. Log: `[VerticalDiffManager] Failed to create diff handler!`
2. Verify active editor URI matches expected URI
3. Ensure file is opened before applying diff

### Issue: Decorations not applied

**Check:**

1. Logs show `[RemovedLineDecoration] Applying decorations`?
2. Check if editor.setDecorations is called
3. Verify decoration types are properly defined

## VS Code Context Keys

The system sets these contexts:

- `konveyor.diffVisible` - True when diff is active
- `konveyor.streamingDiff` - True during diff processing

## Next Steps if Still Not Working

1. **Check Active Editor**
   - The file MUST be the active editor
   - We set `preserveFocus: false` to ensure this

2. **Check Decoration Types**
   - Verify `removedLineDecorationType` and `addedLineDecorationType` are defined
   - Check if colors/styles are properly set

3. **Check Diff Parsing**
   - Verify unified diff is parsed correctly
   - Check if DiffLine[] array has correct types

4. **Manual Test**
   - Try a simple hardcoded diff to isolate parsing issues
   - Test with a minimal file to reduce complexity
