import * as winston from "winston";
import {
  SolutionServerClient,
  SolutionServerClientError,
} from "../src/clients/solutionServerClient";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeLogger(): winston.Logger {
  return winston.createLogger({
    level: "error", // keep test output quiet
    silent: true,
  });
}

/** Build a connected client by injecting a mock MCP client. */
function buildConnectedClient(): {
  client: SolutionServerClient;
  mockMcpClient: { listTools: jest.Mock; listResources: jest.Mock; close: jest.Mock };
} {
  const client = new SolutionServerClient("https://hub.example.com", "fake-token", makeLogger());

  // Simulate a successful connection: poke internal state the same way
  // connect() would after a successful transport handshake.
  const mockMcpClient = {
    listTools: jest.fn().mockResolvedValue({ tools: [{ name: "tool_a" }] }),
    listResources: jest.fn().mockResolvedValue({ resources: [{ name: "res_a" }] }),
    close: jest.fn().mockResolvedValue(undefined),
  };
  // Inject mock MCP client via the private field (test-only access)
  (client as any).mcpClient = mockMcpClient;
  (client as any).isConnected = true;

  return { client, mockMcpClient };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("SolutionServerClient", () => {
  describe("getServerCapabilities", () => {
    it("returns cached capabilities on success", async () => {
      const { client } = buildConnectedClient();

      const caps = await client.getServerCapabilities(true);
      expect(caps.tools).toHaveLength(1);
      expect(caps.resources).toHaveLength(1);
    });

    it("throws SolutionServerClientError on connection error (fetch failed)", async () => {
      const { client, mockMcpClient } = buildConnectedClient();

      // Simulate a connection failure on listTools
      mockMcpClient.listTools.mockRejectedValueOnce(
        Object.assign(new Error("fetch failed"), {
          cause: { code: "ECONNRESET" },
        }),
      );

      await expect(client.getServerCapabilities(true)).rejects.toThrow(SolutionServerClientError);
      // Client should now be marked as disconnected
      expect(client.isConnected).toBe(false);
    });

    it("fires the connection state listener on connection error", async () => {
      const { client, mockMcpClient } = buildConnectedClient();

      const stateChanges: boolean[] = [];
      client.setConnectionStateListener((connected) => {
        stateChanges.push(connected);
      });

      // Simulate a connection failure
      mockMcpClient.listTools.mockRejectedValueOnce(
        Object.assign(new Error("fetch failed"), {
          cause: { code: "ECONNRESET" },
        }),
      );

      await expect(client.getServerCapabilities(true)).rejects.toThrow();

      // The listener should have been notified of the disconnect
      expect(stateChanges).toEqual([false]);
    });

    it("closes the stale MCP client on connection error", async () => {
      const { client, mockMcpClient } = buildConnectedClient();

      mockMcpClient.listTools.mockRejectedValueOnce(
        Object.assign(new Error("fetch failed"), {
          cause: { code: "UND_ERR_CONNECT_TIMEOUT" },
        }),
      );

      await expect(client.getServerCapabilities(true)).rejects.toThrow();

      // The stale client should have been closed
      expect(mockMcpClient.close).toHaveBeenCalled();
      // Internal mcpClient should be null now
      expect((client as any).mcpClient).toBeNull();
    });

    it("rethrows non-connection errors without side-effects", async () => {
      const { client, mockMcpClient } = buildConnectedClient();

      const listener = jest.fn();
      client.setConnectionStateListener(listener);

      // A non-connection error (e.g. protocol/parse error)
      mockMcpClient.listTools.mockRejectedValueOnce(new Error("Invalid JSON"));

      await expect(client.getServerCapabilities(true)).rejects.toThrow("Invalid JSON");

      // Should NOT have disconnected or notified
      expect(client.isConnected).toBe(true);
      expect(listener).not.toHaveBeenCalled();
      expect(mockMcpClient.close).not.toHaveBeenCalled();
    });

    it("detects UND_ERR codes as connection errors", async () => {
      const { client, mockMcpClient } = buildConnectedClient();

      mockMcpClient.listTools.mockRejectedValueOnce(
        Object.assign(new Error("other failure"), {
          cause: { code: "UND_ERR_SOCKET" },
        }),
      );

      await expect(client.getServerCapabilities(true)).rejects.toThrow(SolutionServerClientError);
      expect(client.isConnected).toBe(false);
    });
  });

  describe("setConnectionStateListener", () => {
    it("does not fire on initial construction", () => {
      const client = new SolutionServerClient(
        "https://hub.example.com",
        "fake-token",
        makeLogger(),
      );

      const listener = jest.fn();
      client.setConnectionStateListener(listener);

      // No state change should fire just from setting the listener
      expect(listener).not.toHaveBeenCalled();
    });

    it("fires on disconnect", async () => {
      const { client } = buildConnectedClient();

      const stateChanges: boolean[] = [];
      client.setConnectionStateListener((connected) => {
        stateChanges.push(connected);
      });

      await client.disconnect();

      expect(stateChanges).toEqual([false]);
    });

    it("can be detached by setting null", async () => {
      const { client } = buildConnectedClient();

      const listener = jest.fn();
      client.setConnectionStateListener(listener);
      client.setConnectionStateListener(null);

      await client.disconnect();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("updateBearerToken", () => {
    it("suppresses connection notifications during token update", async () => {
      const { client, mockMcpClient } = buildConnectedClient();

      const stateChanges: boolean[] = [];
      client.setConnectionStateListener((connected) => {
        stateChanges.push(connected);
      });

      // Mock connect() to simulate a successful reconnection.
      jest.spyOn(client, "connect").mockImplementation(async () => {
        // Simulate what connect() does internally
        (client as any).mcpClient = mockMcpClient;
        (client as any).isConnected = true;
        (client as any).cachedCapabilities = { tools: [], resources: [] };
      });

      await client.updateBearerToken("new-token");

      // The disconnect → reconnect cycle should NOT have fired the listener
      // because notifications are suppressed during token update
      expect(stateChanges).toEqual([]);

      jest.restoreAllMocks();
    });

    it("notifies if final state differs after token update failure", async () => {
      const { client } = buildConnectedClient();

      const stateChanges: boolean[] = [];
      client.setConnectionStateListener((connected) => {
        stateChanges.push(connected);
      });

      // Mock connect() to fail — client stays disconnected
      jest.spyOn(client, "connect").mockRejectedValue(new Error("connection failed"));

      await expect(client.updateBearerToken("new-token")).rejects.toThrow("connection failed");

      // Final state is disconnected (was connected), so listener should fire
      expect(stateChanges).toContainEqual(false);

      jest.restoreAllMocks();
    });
  });
});
