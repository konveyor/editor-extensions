import * as vscode from "vscode";
import { getNonce } from "./getNonce";

export function getWebviewContent(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
  isFullScreen: boolean = false,
): string {
  const extensionUri = context.extensionUri;

  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "out", "webview", "main.wv.js"),
  );

  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "out", "webview", "main.css"),
  );

  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en" class="pf-v6-theme-dark">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta 
      http-equiv="Content-Security-Policy"
      content="
        default-src 'none';
        img-src ${webview.cspSource} https: data:;
        style-src ${webview.cspSource};
        font-src ${webview.cspSource};
        script-src 'nonce-${nonce}' ${webview.cspSource};
      "
    >
    <title>Konveyor</title>
    <!-- Link the extracted CSS file -->
    <link rel="stylesheet" href="${styleUri}">
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}">
      window.vscode = acquireVsCodeApi();
      window.addEventListener('load', function() {
        window.vscode.postMessage({ type: 'webviewReady', isFullScreen: ${isFullScreen} });
        console.log('HTML started up. Full screen:', ${isFullScreen});
      });
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>
`;
}
