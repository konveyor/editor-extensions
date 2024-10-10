import * as vscode from "vscode";
import { getWebviewContent } from "./webviewContent";
import { ExtensionState } from "./extensionState";
import { setupWebviewMessageListener } from "./webviewMessageHandler";

export class KonveyorGUIWebviewViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "konveyor.konveyorGUIView";
  private _webview?: vscode.Webview;
  private _webviewView?: vscode.WebviewView;
  private outputChannel: vscode.OutputChannel;
  private webviewReadyCallback?: (webview: vscode.Webview) => void;

  constructor(
    private readonly windowId: string,
    private readonly extensionState: ExtensionState,
  ) {
    this.outputChannel = vscode.window.createOutputChannel("Konveyor");
    this.extensionState.webviewProviders.add(this);
  }

  get isVisible() {
    return this._webviewView?.visible;
  }

  get webview() {
    return this._webview;
  }

  onWebviewReady(callback: (webview: vscode.Webview) => void) {
    this.webviewReadyCallback = callback;
    if (this._webview) {
      callback(this._webview);
    }
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void | Thenable<void> {
    this._webview = webviewView.webview;
    this._webviewView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionState.extensionContext.extensionUri, "media"),
        vscode.Uri.joinPath(this.extensionState.extensionContext.extensionUri, "out"),
      ],
    };

    webviewView.webview.html = getWebviewContent(
      this.extensionState.extensionContext,
      webviewView.webview,
      true,
    );

    setupWebviewMessageListener(webviewView.webview, this.extensionState);

    webviewView.onDidDispose(() => {
      this.extensionState.webviewProviders.delete(this);
    });

    if (this.webviewReadyCallback) {
      this.webviewReadyCallback(webviewView.webview);
    }
  }
}
