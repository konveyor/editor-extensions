import * as vscode from "vscode";
import { ExtensionState } from "./extensionState";
import { loadStateFromDataFolder } from "./data";
import { Change, GetSolutionResult } from "@editor-extensions/shared";
import { fromRelativeToKonveyor } from "./utilities";
import path from "path";

export function setupWebviewMessageListener(webview: vscode.Webview, state: ExtensionState) {
  webview.onDidReceiveMessage(async (message) => {
    switch (message.command) {
      case "getSolution": {
        const { violation, incident } = message;
        const [analysisResults, solution] = await loadStateFromDataFolder();

        const mockSolution: GetSolutionResult = {
          errors: [],
          changes: [
            {
              original: "src/main/java/com/redhat/coolstore/service/CatalogService.java",
              modified: "src/main/java/com/redhat/coolstore/service/CatalogService.java",
              diff: "diff --git a/src/main/java/com/redhat/coolstore/service/CatalogService.java b/src/main/java/com/redhat/coolstore/service/CatalogService.java\nindex 422a3f4..9a6feff 100644\n--- a/src/main/java/com/redhat/coolstore/service/CatalogService.java\n+++ b/src/main/java/com/redhat/coolstore/service/CatalogService.java\n@@ -9,12 +9,12 @@ import javax.persistence.criteria.CriteriaBuilder;\n import javax.persistence.criteria.CriteriaQuery;\n import javax.persistence.criteria.Root;\n \n-import javax.ejb.Stateless;\n+import jakarta.enterprise.context.ApplicationScoped;\n import javax.persistence.EntityManager;\n \n import com.redhat.coolstore.model.*;\n \n-@Stateless\n+@ApplicationScoped\n public class CatalogService {\n \n     @Inject\n",
            },
          ],
        };

        vscode.commands.executeCommand("konveyor.diffView.focus");
        vscode.commands.executeCommand("konveyor.showResolutionPanel");
        const incidentUri = incident.uri;

        // Remove 'file://' from the URI and ensure it doesn't start with a leading slash
        let incidentPath = incidentUri.replace(/^file:\/\//, ""); // Remove 'file://' from the URI

        if (incidentPath.startsWith("/")) {
          incidentPath = incidentPath.slice(1); // Remove the leading slash if it exists
        }

        // Fix: Ensure that the path starts with a valid format (not starting with two slashes)
        const incidentKonveyorUri = fromRelativeToKonveyor(
          vscode.workspace.asRelativePath(incidentPath),
        ); // Convert to konveyor:// format

        console.log("incidentKonveyorUri", incidentKonveyorUri);
        console.log("incidentPath", incidentPath);
        console.log("solution", solution);

        // Step 2: Check if any of the solution changes are relevant to the incident
        const isRelevantSolution = solution?.changes.some((change: Change) => {
          const originalKonveyorUri = fromRelativeToKonveyor(change.original);
          console.log("originalKonveyorUri", originalKonveyorUri);
          console.log("incidentKonveyorUri", incidentKonveyorUri);

          // Compare original URI with incident URI
          return originalKonveyorUri.toString() === incidentKonveyorUri.toString();
        });

        console.log("send this solution to the webview", solution);

        // Step 3: Send the updated solution and the relevance flag to the webview
        state.webviewProviders.get("resolution")?.sendMessageToWebview({
          type: "loadResolution",
          solution: solution,
          violation,
          incident,
          isRelevantSolution,
        });

        break;
      }
      case "getAllSolutions": {
        // vscode.commands.executeCommand("konveyor.getAllSolutions");
        vscode.commands.executeCommand("konveyor.diffView.focus");
        break;
      }
      case "viewFix": {
        const { change, incident } = message;
        let incidentUri: vscode.Uri;

        if (incident.uri.startsWith("file://")) {
          incidentUri = vscode.Uri.parse(incident.uri);
        } else {
          incidentUri = vscode.Uri.file(incident.uri);
        }
        vscode.commands.executeCommand("konveyor.diffView.viewFix", incidentUri, true);
        break;
      }
      case "applyFile": {
        const { change } = message;

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          vscode.window.showErrorMessage("No workspace folder is open.");
          break;
        }

        let currentURI: vscode.Uri;

        if (path.isAbsolute(change.original)) {
          currentURI = vscode.Uri.file(change.original);
        } else {
          const absolutePath = path.resolve(workspaceFolder.uri.fsPath, change.original);
          currentURI = vscode.Uri.file(absolutePath);
        }

        vscode.commands.executeCommand("konveyor.applyFile", currentURI, true);

        break;
      }

      case "requestQuickfix": {
        const { uri, line } = message.data;
        await handleRequestQuickFix(uri, line);
        // Implement the quick fix logic here
        // For example, replace the problematic code with a suggested fix
        // const suggestedCode = message.diagnostic.message; // You might need to parse this appropriately
        // const action = new vscode.CodeAction("Apply Quick Fix", vscode.CodeActionKind.QuickFix);
        // action.edit = new vscode.WorkspaceEdit();
        // action.edit.replace(message.documentUri, message.range, suggestedCode);
        // action.diagnostics = [message.diagnostic];
        // action.isPreferred = true;
        // vscode.commands.executeCommand("vscode.executeCodeActionProvider", message.documentUri, message.range, action);
        break;
      }

      case "startAnalysis": {
        vscode.commands.executeCommand("konveyor.runAnalysis");
        break;
      }

      case "openFile": {
        const fileUri = vscode.Uri.parse(message.file);
        try {
          const doc = await vscode.workspace.openTextDocument(fileUri);
          const editor = await vscode.window.showTextDocument(doc, {
            preview: true,
          });
          const position = new vscode.Position(message.line - 1, 0);
          const range = new vscode.Range(position, position);
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to open file: ${error}`);
        }
        break;
      }
      case "checkServerStatus": {
        const isRunning = state.analyzerClient.isServerRunning();
        webview.postMessage({ type: "serverStatus", isRunning });
        console.log("checkServerStatus", isRunning);
        break;
      }
      case "startServer": {
        vscode.commands.executeCommand("konveyor.startAnalyzer");
        break;
      }
      case "solutionResolved": {
        console.log("solutionResolved");
        const sidebarProvider = state.webviewProviders.get("sidebar");
        sidebarProvider?.webview?.postMessage({
          type: "solutionConfirmation",
          data: { confirmed: true, solution: null },
        });
        // ?.sendMessageToWebview({
        //   type: "solutionConfirmation",
        //   data: { confirmed: true, solution: null },
        // });
        break;
      }

      // Add more cases as needed
    }
  });
}

async function handleRequestQuickFix(uriString: string, lineNumber: number) {
  const uri = vscode.Uri.parse(uriString);
  try {
    // Open the document
    const document = await vscode.workspace.openTextDocument(uri);

    // Show the document in the editor
    const editor = await vscode.window.showTextDocument(document, { preview: false });

    // Move the cursor to the specified line and character
    const position = new vscode.Position(lineNumber - 1, 0); // Adjust line number (0-based index)
    const range = new vscode.Range(position, position);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

    // Trigger the quick fix action at the cursor position
    await vscode.commands.executeCommand("editor.action.quickFix");
  } catch (error: any) {
    vscode.window.showErrorMessage(`Could not open file: ${error?.message as string}`);
  }
}
