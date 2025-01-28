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
  ColorThemeKind,
} from "vscode";
import { getNonce } from "./utilities/getNonce";
import { ExtensionData, WebviewType } from "@editor-extensions/shared";
import { Immutable } from "immer";
import jsesc from "jsesc";

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
    private readonly _viewType: WebviewType,
  ) {}

  isAnalysisView() {
    return this._viewType === "sidebar";
  }

  public resolveWebviewView(
    webviewView: WebviewView,
    _context: WebviewViewResolveContext,
    _token: CancellationToken,
  ): void | Thenable<void> {
    this._view = webviewView;
    this.initializeWebview(webviewView.webview, this._extensionState.data);
  }

  public createWebviewPanel(): void {
    if (this._panel) {
      return;
    }
    this._panel = window.createWebviewPanel(
      this.isAnalysisView()
        ? KonveyorGUIWebviewViewProvider.SIDEBAR_VIEW_TYPE
        : KonveyorGUIWebviewViewProvider.RESOLUTION_VIEW_TYPE,
      this.isAnalysisView() ? "Konveyor Analysis View" : "Resolution Details",
      ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [this._extensionState.extensionContext.extensionUri],
        retainContextWhenHidden: true,
      },
    );

    this.initializeWebview(this._panel.webview, this._extensionState.data);

    this._panel.onDidDispose(() => {
      this.handleViewClosed();
      this._panel = undefined;
      this._isWebviewReady = false;
      this._isPanelReady = false;
    });
  }

  private handleViewClosed(): void {
    // Assuming the analysis webview is tracked and can be accessed via the ExtensionState or similar
    // const sidebarProvider = this._extensionState.webviewProviders.get("sidebar");
    // if (sidebarProvider?.webview && sidebarProvider._isWebviewReady) {
    // sidebarProvider.webview.postMessage({
    //   type: "solutionConfirmation",
    //   data: { confirmed: true, solution: null },
    // });
    // } else {
    // console.error("Analysis webview is not ready or not available.");
    // }
  }

  public showWebviewPanel(): void {
    if (this._panel) {
      this._panel.reveal(ViewColumn.One);
    } else {
      this.createWebviewPanel();
    }
  }

  private initializeWebview(webview: Webview, data: Immutable<ExtensionData>): void {
    const isProd = process.env.NODE_ENV === "production";
    const extensionUri = this._extensionState.extensionContext.extensionUri;

    let assetsUri: Uri;
    if (isProd) {
      assetsUri = Uri.joinPath(extensionUri, "out", "webview", "assets");
    } else {
      assetsUri = Uri.parse("http://localhost:5173");
    }

    webview.options = {
      enableScripts: true,
      localResourceRoots: isProd ? [assetsUri] : [extensionUri],
    };

    webview.html = this.getHtmlForWebview(webview, data);
    this._setWebviewMessageListener(webview);
  }

  public getHtmlForWebview(webview: Webview, data: Immutable<ExtensionData>): string {
    const stylesUri = this._getStylesUri(webview);
    const scriptUri = this._getScriptUri(webview);
    const nonce = getNonce();

    return `<!DOCTYPE html>
    <html lang="en" class="${window.activeColorTheme.kind === ColorThemeKind.Dark ? "pf-v6-theme-dark" : ""}">
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
          window.konveyorInitialData = ${jsesc(data, { json: true, isScriptContext: true })};
        </script>
      </head>
      <body>
        <div id="root"></div>
        ${this._getReactRefreshScript(nonce)}
        <script nonce="${nonce}">
          window.addEventListener('DOMContentLoaded', function() {
            window.vscode.postMessage({ type: 'WEBVIEW_READY' });
          });
        </script>
        <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
      </body>
    </html>`;
  }

  private _getContentSecurityPolicy(nonce: string, webview: Webview): string {
    const isProd = process.env.NODE_ENV === "production";
    const localServerUrl = "localhost:5173";
    return [
      `default-src 'none';`,
      `script-src 'unsafe-eval' https://* ${
        isProd ? `'nonce-${nonce}'` : `http://${localServerUrl} 'nonce-${nonce}' 'unsafe-inline'`
      };`,
      `style-src ${webview.cspSource} 'unsafe-inline' https://* ${isProd ? "" : `http://${localServerUrl}`};`,

      `font-src ${webview.cspSource};`,
      `connect-src https://* ${isProd ? `` : `ws://${localServerUrl} http://${localServerUrl}`};`,
      `img-src https: data:;`,
    ].join(" ");
  }

  private _getScriptUri(webview: Webview): Uri {
    const isProd = process.env.NODE_ENV === "production";
    return isProd
      ? this._getUri(webview, ["assets", "index.js"])
      : Uri.parse("http://localhost:5173/src/index.tsx");
  }

  private _getStylesUri(webview: Webview): Uri {
    const isProd = process.env.NODE_ENV === "production";
    return isProd
      ? this._getUri(webview, ["assets", "index.css"])
      : Uri.parse("http://localhost:5173/src/index.css");
  }

  private _getReactRefreshScript(nonce: string): string {
    const isProd = process.env.NODE_ENV === "production";

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
    const isProd = process.env.NODE_ENV === "production";

    if (isProd) {
      return webview.asWebviewUri(
        Uri.joinPath(
          this._extensionState.extensionContext.extensionUri,
          "out",
          "webview",
          ...pathList,
        ),
      );
    } else {
      const localServerUrl = "http://localhost:5173";
      const assetPath = pathList.join("/");
      return Uri.parse(`${localServerUrl}/${assetPath}`);
    }
  }

  private _setWebviewMessageListener(webview: Webview) {
    setupWebviewMessageListener(webview, this._extensionState);

    webview.onDidReceiveMessage(
      (message) => {
        if (message.type === "WEBVIEW_READY") {
          this._isWebviewReady = true;
          this._isPanelReady = true;
          while (this._messageQueue.length > 0) {
            const queuedMessage = this._messageQueue.shift();
            this.sendMessage(queuedMessage, webview);
          }
        }
      },
      undefined,
      this._disposables,
    );
  }

  public dispose() {
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
  private sendMessage(message: any, webview: Webview) {
    webview.postMessage(message).then((deliveryStatus) => {
      if (!deliveryStatus) {
        console.error(`Message to Konveyor webview '${this._viewType}' not delivered`);
      }
    });
  }

  public sendMessageToWebview(message: any): void {
    if (this._view?.webview && this._isWebviewReady) {
      this.sendMessage(message, this._view.webview);
    } else if (this._panel && this._isPanelReady) {
      this.sendMessage(message, this._panel.webview);
    } else {
      this._messageQueue.push(message);
    }
  }

  public get webview(): Webview | undefined {
    return this._view?.webview;
  }
}
