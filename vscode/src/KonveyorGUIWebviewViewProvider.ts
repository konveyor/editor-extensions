import { ExtensionState } from "./extensionState";
import { setupWebviewMessageListener } from "./webviewMessageHandler";
import {
  Webview,
  WebviewView,
  WebviewViewProvider,
  Disposable,
  Uri,
  CancellationToken,
  WebviewViewResolveContext,
} from "vscode";
import { getUri } from "./utilities/getUri";
import { getNonce } from "./utilities/getNonce";

export class KonveyorGUIWebviewViewProvider implements WebviewViewProvider {
  public static readonly viewType = "konveyor.konveyorGUIView";
  private static instance: KonveyorGUIWebviewViewProvider;
  private _disposables: Disposable[] = [];
  private _view?: WebviewView;
  private _isWebviewReady: boolean = false;

  private constructor(private readonly _extensionState: ExtensionState) {}

  public static getInstance(extensionState: ExtensionState): KonveyorGUIWebviewViewProvider {
    if (!KonveyorGUIWebviewViewProvider.instance) {
      KonveyorGUIWebviewViewProvider.instance = new KonveyorGUIWebviewViewProvider(extensionState);
    }
    return KonveyorGUIWebviewViewProvider.instance;
  }

  public resolveWebviewView(
    webviewView: WebviewView,
    _context: WebviewViewResolveContext,
    _token: CancellationToken,
  ): void | Thenable<void> {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionState.extensionContext.extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    this._setWebviewMessageListener(webviewView.webview);
  }

  public _getHtmlForWebview(webview: Webview): string {
    const stylesUri = this._getUri(webview, ["webview-ui", "build", "assets", "index.css"]);
    const scriptUri = this._getScriptUri(webview);
    const nonce = getNonce();

    return `<!DOCTYPE html>
    <html lang="en" class="pf-v6-theme-dark">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta http-equiv="Content-Security-Policy" content="${this._getContentSecurityPolicy(nonce)}">
        <link rel="stylesheet" type="text/css" href="${stylesUri}">
        <title>Konveyor IDE Extension</title>
         <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          window.vscode = vscode;
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

  private _getContentSecurityPolicy(nonce: string): string {
    const isProd = process.env.NODE_ENV === "production"; // Use environment check

    const localServerUrl = "localhost:5173";
    return [
      `default-src 'none';`,
      `script-src 'unsafe-eval' https://* ${
        isProd ? `'nonce-${nonce}'` : `http://${localServerUrl} 'nonce-${nonce}' 'unsafe-inline'`
      };`,
      `style-src ${this._view!.webview.cspSource} 'unsafe-inline' https://*;`,
      `font-src ${this._view!.webview.cspSource};`,
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
          this._loadInitialContent();
          console.log("Webview is ready");
        }
      },
      undefined,
      this._disposables,
    );
  }

  private _loadInitialContent() {
    if (this._isWebviewReady && this._view) {
      this._extensionState.analyzerClient.populateWebviewWithStoredRulesets(this._view.webview);
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

  public get webview(): Webview | undefined {
    return this._view?.webview;
  }
}
