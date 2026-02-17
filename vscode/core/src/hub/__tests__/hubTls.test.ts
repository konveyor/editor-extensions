import * as fs from "fs";
import * as https from "https";
import * as pathlib from "path";
import { spawn, execFile, type ChildProcess } from "child_process";
import { createLogger } from "winston";
import expect from "expect";

import { getDispatcherWithCertBundle, getFetchWithDispatcher } from "../../utilities/tls";
import { ProfileSyncClient } from "../../clients/ProfileSyncClient";

const scriptsDir = pathlib.join(__dirname, "..", "..", "modelProvider", "__tests__", "scripts");
const certsDir = pathlib.join(scriptsDir, ".certs");
const mockServerPath = pathlib.join(scriptsDir, "fakeHubServer.js");
const certsGenScriptPath = pathlib.join(scriptsDir, "genCerts.sh");

const HUB_PORT = 8444;
const HUB_BASE_URL = `https://localhost:${HUB_PORT}`;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let handle: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(handle!);
  }
}

(process.platform === "linux" ? describe : describe.skip)(
  "Hub self-signed certificate connections",
  () => {
    const logger = createLogger({ silent: true });
    let serverProc: ChildProcess | null = null;

    before(async function (this: Mocha.Context) {
      this.timeout(15000);
      await new Promise<void>((resolve, reject) => {
        execFile("bash", [certsGenScriptPath], { cwd: scriptsDir }, (err) =>
          err ? reject(err) : resolve(),
        );
      });
      serverProc = spawn(process.execPath, [mockServerPath], {
        cwd: scriptsDir,
        env: {
          ...process.env,
          SERVER_CERT: pathlib.join(certsDir, "srv.crt"),
          SERVER_KEY: pathlib.join(certsDir, "srv.key"),
          CA_CERT: pathlib.join(certsDir, "ca.crt"),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let exitedEarly = false;
      let earlyExitMsg = "";
      const stderrChunks: Buffer[] = [];
      serverProc.on("exit", (code, signal) => {
        exitedEarly = true;
        earlyExitMsg = `mock server exited early (code=${code}, signal=${signal})`;
      });
      serverProc.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
      const ca = fs.readFileSync(pathlib.join(certsDir, "ca.crt"));
      const deadlineMs = 10000;
      const start = Date.now();
      let lastError = "";
      const tryOnce = async (): Promise<boolean> =>
        await new Promise<boolean>((resolve) => {
          const req = https.request(
            {
              hostname: "localhost",
              port: HUB_PORT,
              path: "/",
              method: "GET",
              rejectUnauthorized: true,
              ca,
              timeout: 1000,
            },
            (res) => {
              res.resume();
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                resolve(true);
              } else {
                lastError = `HTTP ${res.statusCode}`;
                resolve(false);
              }
            },
          );
          req.on("error", (error) => {
            lastError = error.message;
            resolve(false);
          });
          req.end();
        });

      while (Date.now() - start < deadlineMs) {
        if (exitedEarly) {
          const stderrStr = Buffer.concat(stderrChunks).toString("utf8").trim();
          throw new Error(`${earlyExitMsg}${stderrStr ? `\nSTDERR:\n${stderrStr}` : ""}`);
        }
        if (await tryOnce()) {
          console.log(`Mock Hub server ready after ${Date.now() - start}ms`);
          return;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      if (serverProc) {
        serverProc.kill("SIGKILL");
        serverProc = null;
      }
      throw new Error(`mock Hub HTTPS server failed to start within 10s. Last error: ${lastError}`);
    });

    it("should connect ProfileSyncClient with insecure scoped fetch", async function (this: Mocha.Context) {
      this.timeout(8000);
      const dispatcher = await getDispatcherWithCertBundle(undefined, true);
      const insecureFetch = getFetchWithDispatcher(dispatcher);
      const client = new ProfileSyncClient(HUB_BASE_URL, null, logger, insecureFetch);
      await client.connect();
      expect(client.isConnected).toBe(true);
    });

    it("should fail ProfileSyncClient without insecure fetch", async function (this: Mocha.Context) {
      this.timeout(7000);
      const client = new ProfileSyncClient(HUB_BASE_URL, null, logger);
      try {
        await withTimeout(client.connect(), 5000);
        throw new Error("Should have thrown a certificate error");
      } catch (error) {
        expect(error).toBeDefined();
        const msg = error instanceof Error ? error.message : String(error);
        expect(msg).not.toBe("Should have thrown a certificate error");
      }
    });

    it("should NOT fail ProfileSyncClient when insecure fetch is used", async function (this: Mocha.Context) {
      this.timeout(7000);
      try {
        const dispatcher = await getDispatcherWithCertBundle(undefined, true);
        const insecureFetch = getFetchWithDispatcher(dispatcher);
        const client = new ProfileSyncClient(HUB_BASE_URL, null, logger, insecureFetch);
        await client.connect();
      } catch (error) {
        console.error(error);
        throw new Error("Failed to connect with insecure fetch, this should not happen");
      }
    });

    after(function (this: Mocha.Context) {
      this.timeout(5000);
      if (serverProc && !serverProc.killed) {
        serverProc.kill("SIGKILL");
        serverProc = null;
      }
      fs.rmSync(certsDir, { recursive: true, force: true });
    });
  },
);
