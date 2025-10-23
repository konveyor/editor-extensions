const fs = require("node:fs");
const express = require("express");
const https = require("node:https");

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

const serverOptions = {};
const certPath = process.env.SERVER_CERT;
const keyPath = process.env.SERVER_KEY;
const caPath = process.env.CA_CERT;
if (!certPath || !keyPath || !caPath) {
  console.error("Missing required environment variables: SERVER_CERT, SERVER_KEY, CA_CERT");
  process.exit(1);
}
serverOptions.cert = fs.readFileSync(certPath);
serverOptions.key = fs.readFileSync(keyPath);
serverOptions.ca = fs.readFileSync(caPath);
const srv = https.createServer(serverOptions, app);

srv.on("connection", (socket) => {
  socket.setNoDelay(true);
  // Very aggressive timeout for any connection that doesn't complete quickly
  socket.setTimeout(3000, () => {
    console.log("Socket timeout after 3s - destroying connection (likely TLS handshake failure)");
    socket.destroy();
  });

  // Set additional socket options for faster failure
  socket.setKeepAlive(false);
});

srv.on("tlsClientError", (err, socket) => {
  console.error("TLS Client Error:", err.message);
  console.error("Error code:", err.code);
  if (socket && !socket.destroyed) {
    socket.destroy();
  }
});

srv.on("clientError", (err, socket) => {
  console.error("Client Error:", err.message);
  if (socket && !socket.destroyed) {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  }
});

// Handle secure connection events
srv.on("secureConnection", (socket) => {
  console.log("Secure connection established - TLS handshake completed successfully");
  // Even for successful connections, keep a shorter timeout
  socket.setTimeout(3000, () => {
    console.log("Secure socket timeout after 3s - destroying");
    socket.destroy();
  });
});

// Add a handler for when TLS handshake starts but doesn't complete
srv.on("newSession", (sessionId, sessionData, callback) => {
  console.log("TLS handshake starting - new session");
  const sessionTimer = setTimeout(() => {
    console.log(
      "TLS session establishment timeout - this may indicate certificate validation issues",
    );
  }, 1500);

  // Clear timer when session is established
  callback();
  clearTimeout(sessionTimer);
});

// Handle server startup errors
srv.on("error", (err) => {
  console.error("Server error:", err.message);
  if (err.code === "EADDRINUSE") {
    console.error("Port 8443 is already in use");
  } else if (err.code === "EACCES") {
    console.error("Permission denied - cannot bind to port 8443");
  }
  process.exit(1);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down gracefully");
  srv.close(() => {
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("Received SIGINT, shutting down gracefully");
  srv.close(() => {
    process.exit(0);
  });
});

srv.listen(8443, () => {
  console.log("Mock HTTPS (fail-fast) at https://localhost:8443");
});
