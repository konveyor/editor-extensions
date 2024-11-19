import { ExtensionState } from "./extensionState";
import { setupWebviewMessageListener } from "./webviewMessageHandler";
import {
  Webview,
  WebviewView,
  WebviewViewProvider,
  WebviewPanel,
  Disposable,
  Uri,
  CancellationToken,
  WebviewViewResolveContext,
  ViewColumn,
  window,
} from "vscode";
import { getUri } from "./utilities/getUri";
import { getNonce } from "./utilities/getNonce";

export class KonveyorGUIWebviewViewProvider implements WebviewViewProvider {
  public static readonly SIDEBAR_VIEW_TYPE = "konveyor.konveyorAnalysisView";
  public static readonly RESOLUTION_VIEW_TYPE = "konveyor.konveyorResolutionView";

  private static instance: KonveyorGUIWebviewViewProvider;
  private _disposables: Disposable[] = [];
  private _panel?: WebviewPanel;
  private _view?: WebviewView;
  private _isPanelReady: boolean = false;
  private _isWebviewReady: boolean = false;
  private _messageQueue: any[] = [];

  constructor(
    private readonly _extensionState: ExtensionState,
    private readonly _viewType: string,
  ) {}

  public resolveWebviewView(
    webviewView: WebviewView,
    _context: WebviewViewResolveContext,
    _token: CancellationToken,
  ): void | Thenable<void> {
    this._view = webviewView;
    this.initializeWebview(webviewView.webview);
  }

  public createWebviewPanel(): void {
    if (!this._panel) {
      this._panel = window.createWebviewPanel(
        KonveyorGUIWebviewViewProvider.RESOLUTION_VIEW_TYPE,
        "Resolution Details",
        ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: [this._extensionState.extensionContext.extensionUri],
          retainContextWhenHidden: true,
        },
      );

      this.initializeWebview(this._panel.webview);

      if (this._viewType === KonveyorGUIWebviewViewProvider.RESOLUTION_VIEW_TYPE) {
        const savedData = this._extensionState.sharedState.get("resolutionPanelData");
        if (savedData) {
          this._panel.webview.postMessage({ type: "loadResolutionState", data: savedData });
        }
      }

      this._panel.onDidDispose(() => {
        this.handleResolutionViewClosed();
        this._panel = undefined;
        this._isWebviewReady = false;
        this._isPanelReady = false;
      });
    }
  }

  private handleResolutionViewClosed(): void {
    // Assuming the analysis webview is tracked and can be accessed via the ExtensionState or similar
    const sidebarProvider = this._extensionState.webviewProviders.get("sidebar");
    if (sidebarProvider?.webview && sidebarProvider._isWebviewReady) {
      sidebarProvider.webview.postMessage({
        type: "solutionConfirmation",
        data: { confirmed: true, solution: null },
      });
    } else {
      console.error("Analysis webview is not ready or not available.");
    }
  }

  public showWebviewPanel(): void {
    if (this._panel) {
      this._panel.reveal(ViewColumn.One);
    } else {
      this.createWebviewPanel();
    }
  }

  private initializeWebview(webview: Webview): void {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionState.extensionContext.extensionUri],
    };

    webview.html = this.getHtmlForWebview(webview);
    this._setWebviewMessageListener(webview);

    if (this._isWebviewReady) {
      this._loadInitialContent(webview);
    }
  }

  public getHtmlForWebview(webview: Webview): string {
    const stylesUri = this._getUri(webview, ["webview-ui", "build", "assets", "index.css"]);
    const scriptUri = this._getScriptUri(webview);
    const nonce = getNonce();

    return `<!DOCTYPE html>
    <html lang="en" class="pf-v6-theme-dark">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta http-equiv="Content-Security-Policy" content="${this._getContentSecurityPolicy(nonce, webview)}">
        <link rel="stylesheet" type="text/css" href="${stylesUri}">
        <title>Konveyor IDE Extension</title>
         <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          window.vscode = vscode;
          window.viewType = "${this._viewType}";
        </script>
      </head>
      <body>
        <div id="root"></div>
        ${this._getReactRefreshScript(nonce)}
        <script nonce="${nonce}">
          window.addEventListener('DOMContentLoaded', function() {
            window.vscode.postMessage({ command: 'webviewReady' });
          });
        </script>
        <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
      </body>
    </html>`;
  }

  private _getContentSecurityPolicy(nonce: string, webview: Webview): string {
    const isProd = process.env.NODE_ENV === "production"; // Use environment check
    const localServerUrl = "localhost:5173";
    return [
      `default-src 'none';`,
      `script-src 'unsafe-eval' https://* ${
        isProd ? `'nonce-${nonce}'` : `http://${localServerUrl} 'nonce-${nonce}' 'unsafe-inline'`
      };`,
      `style-src ${webview.cspSource} 'unsafe-inline' https://*;`,
      `font-src ${webview.cspSource};`,
      `connect-src https://* ${isProd ? `` : `ws://${localServerUrl} http://${localServerUrl}`};`,
      `img-src https: data:;`,
    ].join(" ");
  }

  private _getScriptUri(webview: Webview): Uri {
    const isProd = process.env.NODE_ENV === "production";
    return isProd
      ? this._getUri(webview, ["webview-ui", "build", "assets", "index.js"])
      : Uri.parse("http://localhost:5173/src/index.tsx");
  }

  private _getReactRefreshScript(nonce: string): string {
    const isProd = false; // Replace with actual production check
    return isProd
      ? ""
      : `
      <script type="module" nonce="${nonce}">
        import RefreshRuntime from "http://localhost:5173/@react-refresh"
        RefreshRuntime.injectIntoGlobalHook(window)
        window.$RefreshReg$ = () => {}
        window.$RefreshSig$ = () => (type) => type
        window.__vite_plugin_react_preamble_installed__ = true
      </script>`;
  }

  private _getUri(webview: Webview, pathList: string[]): Uri {
    return getUri(webview, this._extensionState.extensionContext.extensionUri, pathList);
  }

  private _setWebviewMessageListener(webview: Webview) {
    setupWebviewMessageListener(webview, this._extensionState);

    webview.onDidReceiveMessage(
      (message) => {
        if (message.command === "webviewReady") {
          this._isWebviewReady = true;
          this._isPanelReady = true;
          while (this._messageQueue.length > 0) {
            const queuedMessage = this._messageQueue.shift();
            webview.postMessage(queuedMessage);
          }
          this._loadInitialContent(webview);
        }
      },
      undefined,
      this._disposables,
    );
  }

  private _loadInitialContent(webview: Webview) {
    if (this._isWebviewReady && webview) {
      const data = this._extensionState.ruleSets;
      webview.postMessage({
        type: "loadStoredAnalysis",
        data,
      });
      //TODO Commenting out in favor of hardcoded solution data in webviewMessageHandler.ts
      // const localChanges = this._extensionState.localChanges;
      // webview.postMessage({
      //   type: "loadSolutions",
      //   solution: localChanges,
      // });
    }
  }

  public dispose() {
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
  public sendMessageToWebview(message: any): void {
    if (this._panel && this._isPanelReady) {
      this._panel.webview.postMessage(message);
    } else {
      // Queue the message until the panel is ready
      this._messageQueue.push(message);
    }
  }

  public get webview(): Webview | undefined {
    return this._view?.webview;
  }
}
