const express = require("express");
const { createAndStart } = require("./mockServerBase");

const app = express();
app.disable("etag");
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ status: "ready" });
});

app.post("/hub/auth/login", (req, res) => {
  const { user, password } = req.body;
  if (!user || !password) {
    return res.status(400).json({ error: "Missing credentials" });
  }
  res.json({
    user: user,
    token: "mock-bearer-token",
    refresh: "mock-refresh-token",
    expiry: 3600,
  });
});

app.get("/hub/applications", (req, res) => {
  res.setHeader("Content-Type", "application/x-yaml");
  res.send("- id: 1\n  name: test-app\n");
});

createAndStart(app, 8444);
