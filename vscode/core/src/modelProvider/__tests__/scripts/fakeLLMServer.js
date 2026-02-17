const express = require("express");
const { createAndStart } = require("./mockServerBase");

const app = express();
app.disable("etag");
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "ready",
    tls_info: {
      protocol: req.socket.getProtocol ? req.socket.getProtocol() : "unknown",
      cipher: req.socket.getCipher ? req.socket.getCipher() : "unknown",
    },
  });
});

function sse(res, deadlineMs = 5000) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const watchdog = setTimeout(() => {
    if (!res.writableEnded) {
      res.write(`event: error\ndata: {"error":"server-timeout"}\n\n`);
      res.end();
    }
  }, deadlineMs);
  res.on("close", () => clearTimeout(watchdog));
  res.on("error", () => clearTimeout(watchdog));
  return (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

// ---------- OpenAI-compatible ----------
app.post("/v1/chat/completions", (req, res) => {
  const isStream = !!req.body?.stream;
  if (!isStream) {
    return res.json({
      id: "cmpl_mock",
      object: "chat.completion",
      choices: [
        { index: 0, message: { role: "assistant", content: "ok-openai" }, finish_reason: "stop" },
      ],
    });
  }
  const send = sse(res, 3000);
  send({
    id: "cmpl_stream",
    object: "chat.completion.chunk",
    choices: [{ delta: { content: "ok-" }, index: 0, finish_reason: null }],
  });
  setTimeout(() => {
    send({
      id: "cmpl_stream",
      object: "chat.completion.chunk",
      choices: [{ delta: { content: "openai" }, index: 0, finish_reason: null }],
    });
    setTimeout(() => {
      res.write("data: [DONE]\n\n");
      res.end();
    }, 50);
  }, 50);
});

// ---------- Google GenAI ----------
app.post("/v1beta/models/:model\\:generateContent", (req, res) => {
  res.json({ candidates: [{ content: { parts: [{ text: "ok-google" }] } }] });
});
app.post("/v1beta/models/:model\\:streamGenerateContent", (req, res) => {
  const send = sse(res, 3000);
  send({ candidates: [{ content: { parts: [{ text: "ok-" }] } }], done: false });
  setTimeout(() => {
    send({ candidates: [{ content: { parts: [{ text: "google" }] } }], done: false });
    setTimeout(() => {
      send({ done: true });
      res.end();
    }, 50);
  }, 50);
});

// ---------- Ollama (NDJSON stream) ----------
app.post("/api/chat", (req, res) => {
  const isStream = !!req.body?.stream;
  if (!isStream) {
    return res.json({ message: { role: "assistant", content: "ok-ollama" } });
  }

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  // first line immediately
  res.write(JSON.stringify({ message: { role: "assistant", content: "ok-" }, done: false }) + "\n");
  const watchdog = setTimeout(() => {
    if (!res.writableEnded) {
      res.write(JSON.stringify({ error: "server-timeout" }) + "\n");
      res.end();
    }
  }, 3000);
  res.on("close", () => clearTimeout(watchdog));
  res.on("error", () => clearTimeout(watchdog));
  setTimeout(() => {
    res.write(
      JSON.stringify({ message: { role: "assistant", content: "ollama" }, done: false }) + "\n",
    );
    setTimeout(() => {
      res.write(JSON.stringify({ done: true }) + "\n");
      res.end();
    }, 50);
  }, 50);
});

// ---------- Bedrock (non-stream + NDJSON stub) ----------
app.post("/model/:modelId/invoke", (req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ outputText: "ok-bedrock" }));
});
app.post("/model/:modelId/invoke-with-response-stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(JSON.stringify({ chunk: "ok-" }) + "\n");
  const watchdog = setTimeout(() => {
    if (!res.writableEnded) {
      res.write(JSON.stringify({ error: "server-timeout" }) + "\n");
      res.end();
    }
  }, 3000);
  res.on("close", () => clearTimeout(watchdog));
  res.on("error", () => clearTimeout(watchdog));
  setTimeout(() => {
    res.write(JSON.stringify({ chunk: "bedrock" }) + "\n");
    setTimeout(() => {
      res.write(JSON.stringify({ end: true }) + "\n");
      res.end();
    }, 50);
  }, 50);
});

createAndStart(app, 8443);
