import * as vscode from "vscode";
import { getNonce } from "./getNonce";
import { getWebviewContent } from "./webviewContent";

export class KonveyorGUIWebviewViewProvider
  implements vscode.WebviewViewProvider
{
  public static readonly viewType = "konveyor.konveyorGUIView";
  private _webview?: vscode.Webview;
  private _webviewView?: vscode.WebviewView;
  private outputChannel: vscode.OutputChannel;
  private webviewReadyCallback?: (webview: vscode.Webview) => void;

  constructor(
    private readonly windowId: string,
    private readonly extensionContext: vscode.ExtensionContext,
  ) {
    this.outputChannel = vscode.window.createOutputChannel("Konveyor");
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
        vscode.Uri.joinPath(this.extensionContext.extensionUri, "media"),
        vscode.Uri.joinPath(this.extensionContext.extensionUri, "out"),
      ],
    };

    webviewView.webview.html = getWebviewContent(
      this.extensionContext,
      webviewView.webview,
      true
    );

    if (this.webviewReadyCallback) {
      this.webviewReadyCallback(webviewView.webview);
    }
  }
}
