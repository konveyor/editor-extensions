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
  commands,
  window,
} from "vscode";
import { getNonce } from "./utilities/getNonce";
import { ExtensionData, MessageTypes, WebviewType } from "@editor-extensions/shared";
import { Immutable } from "immer";
import jsesc from "jsesc";
import { EXTENSION_NAME, EXTENSION_SHORT_NAME } from "./utilities/constants";

const DEV_SERVER_ROOT = "http://localhost:5173/out/webview";

export class KonveyorGUIWebviewViewProvider implements WebviewViewProvider {
  public static readonly SIDEBAR_VIEW_TYPE = `${EXTENSION_NAME}.analysisView`;
  public static readonly RESOLUTION_VIEW_TYPE = `${EXTENSION_NAME}.resolutionView`;
  public static readonly PROFILES_VIEW_TYPE = `${EXTENSION_NAME}.profilesView`;
  public static readonly HUB_VIEW_TYPE = `${EXTENSION_NAME}.hubView`;
  public static readonly CHAT_VIEW_TYPE = `${EXTENSION_NAME}.chatView`;
  public static readonly CHAT_SECONDARY_VIEW_TYPE = `${EXTENSION_NAME}.chatViewSecondary`;

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
  private _isViewReady: boolean = false;
  private _isPanelReady: boolean = false;
  private _messageQueue: any[] = [];
  private _viewReadyListener?: Disposable;
  private _viewCommandListener?: Disposable;
  private _panelReadyListener?: Disposable;
  private _panelCommandListener?: Disposable;

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
    this._initializeWebview(webviewView.webview, this._extensionState.data, "view");

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        if (this._panel) {
          this._panel.dispose();
        }

        const { chatMessages, ...stateFields } = this._extensionState.data;
        const timestamp = new Date().toISOString();
        this.sendMessageToWebview({
          type: MessageTypes.STATE_CHANGE,
          data: stateFields,
          timestamp,
        });
        this.sendMessageToWebview({
          type: MessageTypes.CHAT_STATE_CHANGE,
          chatMessages,
          previousLength: 0,
          timestamp,
        });
      }
    });
  }
  public createWebviewPanel(): void {
    if (this._panel) {
      return;
    }

    const existingPanel = KonveyorGUIWebviewViewProvider.activePanels.get(this._viewType);
    if (existingPanel) {
      existingPanel.reveal(ViewColumn.One);
      this._panel = existingPanel;

      this._setupListeners(this._panel.webview, "panel");

      this._isPanelReady = true;
      while (this._messageQueue.length > 0) {
        const queuedMessage = this._messageQueue.shift();
        this.sendMessage(queuedMessage, this._panel.webview);
      }

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
        case "chat":
          return {
            viewType: KonveyorGUIWebviewViewProvider.CHAT_VIEW_TYPE,
            title: `${EXTENSION_SHORT_NAME} Migration Assistant`,
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

    KonveyorGUIWebviewViewProvider.activePanels.set(this._viewType, this._panel);

    this._initializeWebview(this._panel.webview, this._extensionState.data, "panel");

    this._panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.visible && e.webviewPanel.active) {
        const { chatMessages, ...stateFields } = this._extensionState.data;
        const timestamp = new Date().toISOString();
        this.sendMessageToWebview({
          type: MessageTypes.STATE_CHANGE,
          data: stateFields,
          timestamp,
        });
        this.sendMessageToWebview({
          type: MessageTypes.CHAT_STATE_CHANGE,
          chatMessages,
          previousLength: 0,
          timestamp,
        });
      }
    });

    this._panel.onDidDispose(() => {
      KonveyorGUIWebviewViewProvider.activePanels.delete(this._viewType);
      this._panel = undefined;
      this._isPanelReady = false;
      this._panelReadyListener?.dispose();
      this._panelReadyListener = undefined;
      this._panelCommandListener?.dispose();
      this._panelCommandListener = undefined;

      if (this._view) {
        commands.executeCommand(`${EXTENSION_NAME}.chatView.focus`).then(undefined, () => {
          // Secondary sidebar not available — no-op, the sidebar view is still intact
        });
      }
    });
  }

  public get hasPanel(): boolean {
    return this._panel !== undefined;
  }

  public closePanel(): void {
    if (this._panel) {
      this._panel.dispose();
    }
  }

  public showWebviewPanel(): void {
    if (this._panel) {
      this._panel.reveal(ViewColumn.One);
      return;
    }

    const existingPanel = KonveyorGUIWebviewViewProvider.activePanels.get(this._viewType);
    if (existingPanel) {
      existingPanel.reveal(ViewColumn.One);
      this._panel = existingPanel;

      this._setupListeners(this._panel.webview, "panel");

      this._isPanelReady = true;
      while (this._messageQueue.length > 0) {
        const queuedMessage = this._messageQueue.shift();
        this.sendMessage(queuedMessage, this._panel.webview);
      }

      return;
    }

    this.createWebviewPanel();
  }

  private _initializeWebview(
    webview: Webview,
    data: Immutable<ExtensionData>,
    source: "view" | "panel",
  ): void {
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
    this._setupListeners(webview, source);
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

  private _setupListeners(webview: Webview, source: "view" | "panel") {
    if (source === "view") {
      this._viewReadyListener?.dispose();
      this._viewCommandListener?.dispose();

      this._viewCommandListener = setupWebviewMessageListener(webview, this._extensionState);

      this._viewReadyListener = webview.onDidReceiveMessage((message) => {
        if (message.type === "WEBVIEW_READY") {
          this._isViewReady = true;
          while (this._messageQueue.length > 0) {
            const queuedMessage = this._messageQueue.shift();
            this.sendMessage(queuedMessage, webview);
          }
        }
      });
    } else {
      this._panelReadyListener?.dispose();
      this._panelCommandListener?.dispose();

      this._panelCommandListener = setupWebviewMessageListener(webview, this._extensionState);

      this._panelReadyListener = webview.onDidReceiveMessage((message) => {
        if (message.type === "WEBVIEW_READY") {
          this._isPanelReady = true;
          while (this._messageQueue.length > 0) {
            const queuedMessage = this._messageQueue.shift();
            this.sendMessage(queuedMessage, webview);
          }
        }
      });
    }
  }

  public dispose() {
    this._panel = undefined;
    this._isViewReady = false;
    this._isPanelReady = false;

    this._viewReadyListener?.dispose();
    this._viewReadyListener = undefined;
    this._viewCommandListener?.dispose();
    this._viewCommandListener = undefined;
    this._panelReadyListener?.dispose();
    this._panelReadyListener = undefined;
    this._panelCommandListener?.dispose();
    this._panelCommandListener = undefined;
  }
  private sendMessage(message: any, webview: Webview) {
    webview.postMessage(message).then((deliveryStatus) => {
      if (!deliveryStatus) {
        console.error(`Message to Konveyor webview '${this._viewType}' not delivered`);
      }
    });
  }

  public sendMessageToWebview(message: any): void {
    let delivered = false;
    if (this._view?.webview && this._isViewReady) {
      this.sendMessage(message, this._view.webview);
      delivered = true;
    }
    if (this._panel && this._isPanelReady) {
      this.sendMessage(message, this._panel.webview);
      delivered = true;
    }
    if (!delivered) {
      this._messageQueue.push(message);
    }
  }

  public get webview(): Webview | undefined {
    return this._view?.webview;
  }
}
