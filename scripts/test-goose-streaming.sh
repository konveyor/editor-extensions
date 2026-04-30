#!/bin/bash
# Test Goose ACP streaming granularity by sending a simple prompt
# and counting the agent_message_chunk notifications received.

GOOSE_BIN="${1:-goose}"

# Create a temp file for goose stdout
OUTFILE=$(mktemp)
trap 'rm -f "$OUTFILE"; kill $GOOSE_PID 2>/dev/null' EXIT

# Start goose acp in background, capture stdout
mkfifo /tmp/goose_stdin_$$
"$GOOSE_BIN" acp < /tmp/goose_stdin_$$ > "$OUTFILE" 2>/dev/null &
GOOSE_PID=$!

# Open the fifo for writing (keeps it open)
exec 3>/tmp/goose_stdin_$$
rm /tmp/goose_stdin_$$

sleep 1

# 1. Initialize
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"0.1","clientInfo":{"name":"streaming-test","version":"0.1"},"capabilities":{}}}' >&3
sleep 1

# 2. Create session
echo '{"jsonrpc":"2.0","id":2,"method":"session/new","params":{}}' >&3
sleep 1

# Extract session ID from the response
SESSION_ID=$(grep -o '"sessionId":"[^"]*"' "$OUTFILE" | head -1 | cut -d'"' -f4)
if [ -z "$SESSION_ID" ]; then
  echo "ERROR: Could not extract session ID from goose output."
  echo "Raw output:"
  cat "$OUTFILE"
  exit 1
fi
echo "Session ID: $SESSION_ID"

# 3. Send a short prompt
echo "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"session/prompt\",\"params\":{\"sessionId\":\"$SESSION_ID\",\"prompt\":[{\"type\":\"text\",\"text\":\"Say hello in exactly one sentence.\"}]}}" >&3

# Wait for response (up to 30s)
echo "Waiting for response..."
for i in $(seq 1 60); do
  if grep -q '"stopReason"' "$OUTFILE" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

# Close stdin to goose
exec 3>&-

# Count and analyze chunks
echo ""
echo "=== Results ==="
TOTAL_LINES=$(wc -l < "$OUTFILE")
CHUNK_COUNT=$(grep -c 'agent_message_chunk' "$OUTFILE")
THOUGHT_COUNT=$(grep -c 'agent_thought_chunk' "$OUTFILE")
TOOL_COUNT=$(grep -c '"tool_call"' "$OUTFILE")

echo "Total ndjson lines: $TOTAL_LINES"
echo "agent_message_chunk count: $CHUNK_COUNT"
echo "agent_thought_chunk count: $THOUGHT_COUNT"
echo "tool_call count: $TOOL_COUNT"

echo ""
echo "=== Chunk sizes (text length per agent_message_chunk) ==="
grep 'agent_message_chunk' "$OUTFILE" | while read -r line; do
  TEXT=$(echo "$line" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['params']['update']['content'].get('text',''))" 2>/dev/null)
  echo "  chunk: ${#TEXT} chars: $(echo "$TEXT" | head -c 60 | tr '\n' '↵')..."
done

echo ""
echo "=== Raw agent_message_chunk lines ==="
grep 'agent_message_chunk' "$OUTFILE" | head -10
if [ "$CHUNK_COUNT" -gt 10 ]; then
  echo "  ... ($((CHUNK_COUNT - 10)) more)"
fi
