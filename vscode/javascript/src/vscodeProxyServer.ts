import * as vscode from "vscode";
import { createServer, Server, Socket } from "net";
import * as rpc from "vscode-jsonrpc/node";
import { Logger } from "winston";

/**
 * LSP Proxy Server
 *
 * Creates a JSON-RPC server over Unix Domain Socket (or Windows named pipe)
 * that forwards LSP requests from java-external-provider to JDTLS via VSCode API.
 */
export class vscodeProxyServer implements vscode.Disposable {
  private server: Server | null = null;
  private connections: Set<rpc.MessageConnection> = new Set();
  private socketPath: string;

  constructor(
    socketPath: string,
    private logger: Logger,
  ) {
    this.socketPath = socketPath;
    this.logger = logger.child({ component: "vscodeProxyServer" });
  }

  /**
   * Start the JSON-RPC server listening on the socket
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((socket: Socket) => {
        this.logger.info("Javascript external provider connected to LSP proxy");
        this.handleConnection(socket);
      });

      this.server.on("error", (err) => {
        this.logger.error("LSP proxy server error", err);
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        this.logger.info(`vscode proxy server listening on ${this.socketPath}`);
        resolve();
      });
    });
  }

  /**
   * Handle a new connection from java-external-provider
   */
  private handleConnection(socket: Socket): void {
    const reader = new rpc.SocketMessageReader(socket, "utf-8");
    const writer = new rpc.SocketMessageWriter(socket, "utf-8");

    const connection = rpc.createMessageConnection(reader, writer);

    // Track this connection
    this.connections.add(connection);

    // Handle workspace/executeCommand requests
    connection.onRequest("workspace/symbol", async (params: any) => {
      this.logger.debug("Received workspace/symbol", { params });

      // Taken from @savitha's work for golang provider.
      try {
        const query = Array.isArray(params) ? params[0]?.query : params?.query;

        const result = await vscode.commands.executeCommand(
          "vscode.executeWorkspaceSymbolProvider",
          query,
        );

        this.logger.debug(
          `Workspace symbol result: ${Array.isArray(result) ? result.length : 0} symbols`,
        );
        return result || [];
      } catch (error) {
        this.logger.error(`Workspace symbol error`, error);
        return [];
      }
    });

    // Handle other LSP requests that java-external-provider might send
    connection.onRequest("textDocument/definition", async (params: any) => {
      this.logger.debug(`Text document definition request`, {
        uri: params.textDocument?.uri,
        position: params.position,
      });

      try {
        const result = await vscode.commands.executeCommand(
          "vscode.executeDefinitionProvider",
          vscode.Uri.parse(params.textDocument.uri),
          new vscode.Position(params.position.line, params.position.character),
        );

        this.logger.debug(
          `Definition result: ${Array.isArray(result) ? result.length : 1} locations`,
        );
        return result;
      } catch (error) {
        this.logger.error(`Text document definition error`, error);
        throw error;
      }
    });

    connection.onRequest("textDocument/references", async (params: any) => {
      this.logger.debug(`Text document references request`, {
        uri: params.textDocument?.uri,
        position: params.position,
      });

      try {
        const result = await vscode.commands.executeCommand(
          "vscode.executeReferenceProvider",
          vscode.Uri.parse(params.textDocument.uri),
          new vscode.Position(params.position.line, params.position.character),
        );

        this.logger.debug(
          `References result: ${Array.isArray(result) ? result.length : 0} locations`,
        );
        return result;
      } catch (error) {
        this.logger.error(`Text document references error`, error);
        throw error;
      }
    });

    // Handle connection close
    connection.onClose(() => {
      this.logger.info("Javascript external provider disconnected from LSP proxy");
      this.connections.delete(connection);
    });

    connection.onError((error) => {
      this.logger.error("Connection error", error);
    });

    // Start listening
    connection.listen();
  }

  /**
   * Get the socket path where the server is listening
   */
  getSocketPath(): string {
    return this.socketPath;
  }

  /**
   * Stop the server and close all connections
   */
  dispose(): void {
    this.logger.info("Stopping LSP proxy server");

    // Close all active connections
    for (const connection of this.connections) {
      connection.dispose();
    }
    this.connections.clear();

    // Close the server
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
