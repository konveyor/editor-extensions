const fs = require("node:fs");
const https = require("node:https");

function createAndStart(app, port) {
  const certPath = process.env.SERVER_CERT;
  const keyPath = process.env.SERVER_KEY;
  const caPath = process.env.CA_CERT;
  if (!certPath || !keyPath || !caPath) {
    console.error("Missing required environment variables: SERVER_CERT, SERVER_KEY, CA_CERT");
    process.exit(1);
  }

  const serverOptions = {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
    ca: fs.readFileSync(caPath),
  };

  const srv = https.createServer(serverOptions, app);

  srv.on("connection", (socket) => {
    socket.setNoDelay(true);
    socket.setTimeout(3000, () => {
      console.log("Socket timeout after 3s - destroying connection (likely TLS handshake failure)");
      socket.destroy();
    });
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

  srv.on("secureConnection", (socket) => {
    console.log("Secure connection established - TLS handshake completed successfully");
    socket.setTimeout(3000, () => {
      console.log("Secure socket timeout after 3s - destroying");
      socket.destroy();
    });
  });

  srv.on("error", (err) => {
    console.error("Server error:", err.message);
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use`);
    } else if (err.code === "EACCES") {
      console.error(`Permission denied - cannot bind to port ${port}`);
    }
    process.exit(1);
  });

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

  srv.listen(port, () => {
    console.log(`Mock HTTPS (fail-fast) at https://localhost:${port}`);
  });

  return srv;
}

module.exports = { createAndStart };
