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
import { getNonce } from "./utilities/getNonce";
import { ExtensionData, WebviewType } from "@editor-extensions/shared";
import { Immutable } from "immer";
import jsesc from "jsesc";
import { EXTENSION_NAME, EXTENSION_SHORT_NAME } from "./utilities/constants";

const DEV_SERVER_ROOT = "http://localhost:5173/out/webview";

export class KonveyorGUIWebviewViewProvider implements WebviewViewProvider {
  public static readonly SIDEBAR_VIEW_TYPE = `${EXTENSION_NAME}.analysisView`;
  public static readonly RESOLUTION_VIEW_TYPE = `${EXTENSION_NAME}.resolutionView`;
  public static readonly PROFILES_VIEW_TYPE = `${EXTENSION_NAME}.profilesView`;
  public static readonly HUB_VIEW_TYPE = `${EXTENSION_NAME}.hubView`;

  private static activePanels: Map<string, WebviewPanel> = new Map();

  public static disposeAllPanels(): void {
    KonveyorGUIWebviewViewProvider.activePanels.forEach((panel) => {
      try {
        panel.dispose();
      } catch (error) {
        console.error("Error disposing webview panel:", error);
      }
    });
    KonveyorGUIWebviewViewProvider.activePanels.clear();
  }
  private _panel?: WebviewPanel;
  private _view?: WebviewView;
  private _isPanelReady: boolean = false;
  private _isWebviewReady: boolean = false;
  private _messageQueue: any[] = [];
  private _webviewReadyListenerDisposable?: Disposable; // Listener for WEBVIEW_READY message
  private _commandMessageListenerDisposable?: Disposable; // Listener for all other webview commands

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

    // Check if a panel for this viewType already exists
    const existingPanel = KonveyorGUIWebviewViewProvider.activePanels.get(this._viewType);
    if (existingPanel) {
      // Panel already exists, just reveal it and update our reference
      existingPanel.reveal(ViewColumn.One);
      this._panel = existingPanel;

      // IMPORTANT: Set up message listeners for this provider instance
      // This ensures messages are handled by the correct provider
      this._setWebviewMessageListener(this._panel.webview);

      // Panel was already initialized; mark it ready and flush queued messages
      this._isPanelReady = true;
      this._isWebviewReady = true;
      while (this._messageQueue.length > 0) {
        const queuedMessage = this._messageQueue.shift();
        this.sendMessage(queuedMessage, this._panel.webview);
      }

      // Do not add a disposal handler here - the panel already has one from creation
      // that will remove it from activePanels when disposed

      return;
    }

    const panelOptions: { viewType: string; title: string } = (() => {
      switch (this._viewType) {
        case "sidebar":
          return {
            viewType: KonveyorGUIWebviewViewProvider.SIDEBAR_VIEW_TYPE,
            title: `${EXTENSION_SHORT_NAME} Analysis View`,
          };
        case "resolution":
          return {
            viewType: KonveyorGUIWebviewViewProvider.RESOLUTION_VIEW_TYPE,
            title: `${EXTENSION_SHORT_NAME} Resolution Details`,
          };
        case "profiles":
          return {
            viewType: KonveyorGUIWebviewViewProvider.PROFILES_VIEW_TYPE,
            title: `${EXTENSION_SHORT_NAME} Manage Profiles`,
          };
        case "hub":
          return {
            viewType: KonveyorGUIWebviewViewProvider.HUB_VIEW_TYPE,
            title: `${EXTENSION_SHORT_NAME} Hub Configuration`,
          };
        default:
          throw new Error(`Unsupported view type: ${this._viewType}`);
      }
    })();

    this._panel = window.createWebviewPanel(
      panelOptions.viewType,
      panelOptions.title,
      ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [this._extensionState.extensionContext.extensionUri],
        retainContextWhenHidden: true,
      },
    );

    // Track this panel in the static map
    KonveyorGUIWebviewViewProvider.activePanels.set(this._viewType, this._panel);

    this.initializeWebview(this._panel.webview, this._extensionState.data);

    this._panel.onDidDispose(() => {
      // Remove from the static map when disposed
      KonveyorGUIWebviewViewProvider.activePanels.delete(this._viewType);
      this._panel = undefined;
      this._isWebviewReady = false;
      this._isPanelReady = false;
    });
  }

  public showWebviewPanel(): void {
    // Check if we already have a panel reference
    if (this._panel) {
      this._panel.reveal(ViewColumn.One);
      return;
    }

    // Check if another instance has created a panel for this viewType
    const existingPanel = KonveyorGUIWebviewViewProvider.activePanels.get(this._viewType);
    if (existingPanel) {
      // Use the existing panel
      existingPanel.reveal(ViewColumn.One);
      this._panel = existingPanel;

      // Set up message listeners for this provider instance
      this._setWebviewMessageListener(this._panel.webview);

      // Panel was already initialized; mark it ready and flush queued messages
      this._isPanelReady = true;
      this._isWebviewReady = true;
      while (this._messageQueue.length > 0) {
        const queuedMessage = this._messageQueue.shift();
        this.sendMessage(queuedMessage, this._panel.webview);
      }

      // Do not add a disposal handler here - the panel already has one from creation
      // that will remove it from activePanels when disposed

      return;
    }

    // No panel exists, create a new one
    this.createWebviewPanel();
  }

  private initializeWebview(webview: Webview, data: Immutable<ExtensionData>): void {
    const isProd = process.env.NODE_ENV === "production";
    const extensionUri = this._extensionState.extensionContext.extensionUri;

    let assetsUri: Uri;
    if (isProd) {
      assetsUri = Uri.joinPath(extensionUri, "out", "webview");
    } else {
      assetsUri = Uri.parse(DEV_SERVER_ROOT);
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

  /**
   * @link https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
   */
  private _getContentSecurityPolicy(nonce: string, webview: Webview): string {
    const isProd = process.env.NODE_ENV === "production";
    const localServerUrl = "localhost:*";

    if (isProd) {
      // Production CSP - stricter, only allow local resources
      return [
        `default-src 'none'`,
        `script-src 'nonce-${nonce}' 'unsafe-eval'`,
        `style-src ${webview.cspSource} 'unsafe-inline'`,
        `font-src ${webview.cspSource} data:`,
        `img-src ${webview.cspSource} data: https:`,
        `connect-src ${webview.cspSource}`,
      ].join("; ");
    } else {
      // Development CSP - allow local dev server
      return [
        `default-src 'none'`,
        `script-src 'nonce-${nonce}' 'unsafe-eval' ${webview.cspSource} http://${localServerUrl}`,
        `style-src ${webview.cspSource} 'unsafe-inline' http://${localServerUrl}`,
        `font-src ${webview.cspSource} data: http://${localServerUrl}`,
        `img-src ${webview.cspSource} data: https: http://${localServerUrl}`,
        `connect-src ${webview.cspSource} http://${localServerUrl} ws://${localServerUrl}`,
      ].join("; ");
    }
  }

  private _getScriptUri(webview: Webview): Uri {
    const isProd = process.env.NODE_ENV === "production";
    return isProd
      ? this._getUri(webview, ["assets", "index.js"])
      : Uri.parse(`${DEV_SERVER_ROOT}/src/index.tsx`);
  }

  private _getStylesUri(webview: Webview): Uri {
    const isProd = process.env.NODE_ENV === "production";
    return isProd
      ? this._getUri(webview, ["assets", "index.css"])
      : Uri.parse(`${DEV_SERVER_ROOT}/src/index.css`);
  }

  private _getReactRefreshScript(nonce: string): string {
    const isProd = process.env.NODE_ENV === "production";

    return isProd
      ? ""
      : `
      <script type="module" nonce="${nonce}">
        import RefreshRuntime from "${DEV_SERVER_ROOT}/@react-refresh"
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
      const assetPath = pathList.join("/");
      return Uri.parse(`${DEV_SERVER_ROOT}/${assetPath}`);
    }
  }

  private _setWebviewMessageListener(webview: Webview) {
    // Dispose previous listeners if they exist to prevent duplicates
    if (this._webviewReadyListenerDisposable) {
      this._webviewReadyListenerDisposable.dispose();
      this._webviewReadyListenerDisposable = undefined;
    }
    if (this._commandMessageListenerDisposable) {
      this._commandMessageListenerDisposable.dispose();
      this._commandMessageListenerDisposable = undefined;
    }

    // Set up the main message handler that processes all webview actions
    // (RUN_ANALYSIS, GET_SOLUTION, OPEN_FILE, etc.) except WEBVIEW_READY
    this._commandMessageListenerDisposable = setupWebviewMessageListener(
      webview,
      this._extensionState,
    );

    // Set up ready listener specifically for the WEBVIEW_READY message
    this._webviewReadyListenerDisposable = webview.onDidReceiveMessage((message) => {
      if (message.type === "WEBVIEW_READY") {
        this._isWebviewReady = true;
        this._isPanelReady = true;
        while (this._messageQueue.length > 0) {
          const queuedMessage = this._messageQueue.shift();
          this.sendMessage(queuedMessage, webview);
        }
      }
    });
  }

  public dispose() {
    // Clear instance state
    this._panel = undefined;
    this._isWebviewReady = false;
    this._isPanelReady = false;

    // Dispose webview message listeners if they exist
    if (this._webviewReadyListenerDisposable) {
      this._webviewReadyListenerDisposable.dispose();
      this._webviewReadyListenerDisposable = undefined;
    }
    if (this._commandMessageListenerDisposable) {
      this._commandMessageListenerDisposable.dispose();
      this._commandMessageListenerDisposable = undefined;
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
