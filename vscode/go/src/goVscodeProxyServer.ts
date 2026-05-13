import * as vscode from "vscode";
import { createServer, Server, Socket } from "net";
import * as rpc from "vscode-jsonrpc/node";
import { createConverter } from "vscode-languageclient/lib/common/codeConverter";
import * as proto from "vscode-languageserver-protocol";
import { Logger } from "winston";

/**
 * LSP Proxy Server for Go
 *
 * Creates a JSON-RPC server over Unix Domain Socket (or Windows named pipe)
 * that forwards LSP requests from generic-external-provider to gopls (go lang ext vscode) via VSCode API.
 */
export class GoVscodeProxyServer implements vscode.Disposable {
  private server: Server | null = null;
  private connections: Set<rpc.MessageConnection> = new Set();
  private socketPath: string;
  private converter = createConverter();

  constructor(
    socketPath: string,
    private logger: Logger,
  ) {
    this.socketPath = socketPath;
    this.logger = logger.child({ component: "GoVscodeProxyServer" });
  }

  /**
   * Start the JSON-RPC server listening on the socket
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((socket: Socket) => {
        this.logger.info("Go external provider connected to LSP proxy");
        this.handleConnection(socket);
      });

      this.server.on("error", (err) => {
        this.logger.error("LSP proxy server error", err);
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        this.logger.info(`Go proxy server listening on ${this.socketPath}`);
        resolve();
      });
    });
  }

  /**
   * Handle a new connection from go-external-provider
   */
  private handleConnection(socket: Socket): void {
    const reader = new rpc.SocketMessageReader(socket, "utf-8");
    const writer = new rpc.SocketMessageWriter(socket, "utf-8");

    const connection = rpc.createMessageConnection(reader, writer);

    // Track this connection
    this.connections.add(connection);

    // Handle workspace/symbol requests
    connection.onRequest("workspace/symbol", async (params: any) => {
      this.logger.info("Received workspace/symbol", { params });
      // Intentionally not handling workspace/symbol requests to allow the generic provider to use documentSymbol based search
      return [];
    });

    // Handle other LSP requests that go-external-provider might send
    connection.onRequest("textDocument/definition", async (params: any) => {
      this.logger.info(`Text document definition request`, {
        uri: params.textDocument?.uri,
        position: params.position,
      });

      try {
        const result: vscode.Location[] = await vscode.commands.executeCommand(
          "vscode.executeDefinitionProvider",
          vscode.Uri.parse(params.textDocument.uri),
          new vscode.Position(params.position.line, params.position.character),
        );

        this.logger.info(
          `Definition result: ${Array.isArray(result) ? result.length : 1} locations`,
        );
        return result?.map((location) => this.converter.asLocation(location)) || [];
      } catch (error) {
        this.logger.error(`Text document definition error`, error);
        throw error;
      }
    });

    connection.onRequest("textDocument/references", async (params: any) => {
      this.logger.info(`Text document references request`, {
        uri: params.textDocument?.uri,
        position: params.position,
      });

      try {
        const result: vscode.Location[] = await vscode.commands.executeCommand(
          "vscode.executeReferenceProvider",
          vscode.Uri.parse(params.textDocument.uri),
          new vscode.Position(params.position.line, params.position.character),
        );

        this.logger.info(
          `References result: ${Array.isArray(result) ? result.length : 0} locations`,
        );
        return result?.map((location) => this.converter.asLocation(location)) || [];
      } catch (error) {
        this.logger.error(`Text document references error`, error);
        throw error;
      }
    });

    // Handle textDocument/didOpen requests
    connection.onNotification("textDocument/didOpen", async (params: any) => {
      try {
        await vscode.workspace.openTextDocument(params.textDocument.uri);
      } catch (error) {
        this.logger.error("Failed to open text document", { error, params });
      }
    });

    // Handle textDocument/documentSymbol requests
    connection.onRequest("textDocument/documentSymbol", async (params: any) => {
      this.logger.info("Received textDocument/documentSymbol", {
        uri: params.textDocument?.uri,
      });

      try {
        const result: vscode.DocumentSymbol[] = await vscode.commands.executeCommand(
          "vscode.executeDocumentSymbolProvider",
          vscode.Uri.parse(params.textDocument.uri),
        );

        this.logger.info(`Document symbol result: ${result?.length || 0} symbols`);

        const converterFunc = (symbol: vscode.DocumentSymbol): proto.DocumentSymbol => {
          return {
            name: symbol.name,
            kind: this.converter.asSymbolKind(symbol.kind),
            selectionRange: this.converter.asRange(symbol.selectionRange),
            range: this.converter.asRange(symbol.range),
            children: symbol.children?.map(converterFunc),
          };
        };

        return result?.map(converterFunc) || [];
      } catch (error) {
        this.logger.error("Failed to get document symbols", { error, params });
        return [];
      }
    });

    // Handle connection close
    connection.onClose(() => {
      this.logger.info("Go external provider disconnected from LSP proxy");
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
