import { ExtensionState } from "./extensionState";
import { setupWebviewMessageListener } from "./webviewMessageHandler";
import {
  CancellationToken,
  Webview,
  WebviewView,
  WebviewViewProvider,
  WebviewViewResolveContext,
  Disposable,
  window,
} from "vscode";
import { getUri } from "./utilities/getUri";
import { Extension } from "./helpers/Extension";
import { getNonce } from "./utilities/getNonce";

export class KonveyorGUIWebviewViewProvider implements WebviewViewProvider {
  public static readonly viewType = "konveyor.konveyorGUIView";
  private static instance: KonveyorGUIWebviewViewProvider;
  private _disposables: Disposable[] = [];
  private _view?: WebviewView;
  private _webviewView?: WebviewView;

  constructor(private readonly _extensionState: ExtensionState) {}

  public static getInstance(_extensionState: ExtensionState): KonveyorGUIWebviewViewProvider {
    if (!KonveyorGUIWebviewViewProvider.instance) {
      KonveyorGUIWebviewViewProvider.instance = new KonveyorGUIWebviewViewProvider(_extensionState);
    }

    return KonveyorGUIWebviewViewProvider.instance;
  }

  resolveWebviewView(
    webviewView: WebviewView,
    _context: WebviewViewResolveContext,
    _token: CancellationToken,
  ) {
    this._view = webviewView;

    this._view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionState.extensionContext.extensionUri],
    };

    // webviewView.webview.html = getWebviewContent(
    //   this._extensionState.extensionContext,
    //   webviewView.webview,
    //   true,
    // );
    this._view.webview.html = this._getHtmlForWebview(this._view.webview);
    this._setWebviewMessageListener(this._view.webview);

    // webviewView.webview.onDidReceiveMessage((message) => {
    //   if (message.type === "webviewReady") {
    //     console.log("Webview is ready, setting up message listener");
    //     setupWebviewMessageListener(webviewView.webview, this.extensionState);

    //     console.log("Populating webview with stored rulesets");
    //     this.extensionState.analyzerClient.populateWebviewWithStoredRulesets(webviewView.webview);
    //   }
    // });
  }
  public dispose() {
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  public _getHtmlForWebview(webview: Webview, isFullScreen: boolean = false) {
    const file = "src/index.tsx";
    const localPort = "5173";
    const localServerUrl = `localhost:${localPort}`;

    // The CSS file from the React build output
    const stylesUri = getUri(webview, this._extensionState.extensionContext.extensionUri, [
      "webview-ui",
      "build",
      "assets",
      "index.css",
    ]);

    let scriptUri;
    const isProd = Extension.getInstance().isProductionMode;
    if (isProd) {
      scriptUri = getUri(webview, this._extensionState.extensionContext.extensionUri, [
        "webview-ui",
        "build",
        "assets",
        "index.js",
      ]);
    } else {
      scriptUri = `http://${localServerUrl}/${file}`;
    }

    const nonce = getNonce();

    const reactRefresh = /*html*/ `
      <script type="module">
        import RefreshRuntime from "http://localhost:5173/@react-refresh"
        RefreshRuntime.injectIntoGlobalHook(window)
        window.$RefreshReg$ = () => {}
        window.$RefreshSig$ = () => (type) => type
        window.__vite_plugin_react_preamble_installed__ = true
      </script>`;

    const reactRefreshHash = "sha256-YmMpkm5ow6h+lfI3ZRp0uys+EUCt6FOyLkJERkfVnTY=";

    const csp = [
      `default-src 'none';`,
      `script-src 'unsafe-eval' https://* ${
        isProd
          ? `'nonce-${nonce}'`
          : `http://${localServerUrl} http://0.0.0.0:${localPort} '${reactRefreshHash}'`
      }`,
      `style-src ${webview.cspSource} 'self' 'unsafe-inline' https://*`,
      `font-src ${webview.cspSource}`,
      `connect-src https://* ${
        isProd
          ? ``
          : `ws://${localServerUrl} ws://0.0.0.0:${localPort} http://${localServerUrl} http://0.0.0.0:${localPort}`
      }`,
    ];

    return /*html*/ `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta http-equiv="Content-Security-Policy" content="${csp.join("; ")}">
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="stylesheet" type="text/css" href="${stylesUri}">
        <title>VSCode React Starter</title>
      </head>
      <body>
        <div id="root"></div>
        ${isProd ? "" : reactRefresh}
        <script type="module" src="${scriptUri}">
          window.addEventListener('load', function() {
          window.vscode.postMessage({ type: 'webviewReady', isFullScreen: ${isFullScreen} });
          console.log('HTML started up. Full screen:', ${isFullScreen});
      });
        </script>
      </body>
    </html>`;
  }

  /**
   * Sets up an event listener to listen for messages passed from the webview context and
   * executes code based on the message that is recieved.
   *
   * @param webview A reference to the extension webview
   * @param context A reference to the extension context
   */
  private _setWebviewMessageListener(webview: Webview) {
    webview.onDidReceiveMessage(
      (message: any) => {
        const command = message.command;
        const text = message.text;

        switch (command) {
          case "webviewReady": {
            console.log("Webview is ready, setting up message listener");
            setupWebviewMessageListener(webview, this._extensionState);
            console.log("Populating webview with stored rulesets");
            this._extensionState.analyzerClient.populateWebviewWithStoredRulesets(webview);
            break;
          }

          case "hello":
            // Code that should run in response to the hello message command
            window.showInformationMessage(text);
            return;
          // Add more switch case statements here as more webview message commands
          // are created within the webview context (i.e. inside media/main.js)
        }
      },
      undefined,
      this._disposables,
    );
  }
  public get webview(): Webview | undefined {
    return this._view?.webview;
  }
}
