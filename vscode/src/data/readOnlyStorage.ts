import {
  CancellationToken,
  Event,
  ProviderResult,
  TextDocumentContentProvider,
  Uri,
  workspace,
} from "vscode";

export default class KonveyorReadOnlyProvider implements TextDocumentContentProvider {
  onDidChange?: Event<Uri>;
  provideTextDocumentContent(uri: Uri, _token: CancellationToken): ProviderResult<string> {
    return workspace.fs
      .readFile(Uri.from({ ...uri, scheme: "file" }))
      .then((buffer) => buffer?.toString() ?? "");
  }
}
