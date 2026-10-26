import * as vscode from 'vscode';

/** The workspace file an editor is showing. Usually its own URI — but other versions of a
 * file, opened from Source Control (Git's "(Index)" and "(HEAD)" views, either side of a
 * diff), have a non-file URI (git:...) that still carries the file's path, so they map
 * back to the working copy: the puzzle is recognized, and the solver runs the real file. */
export function editorFileUri(document: vscode.TextDocument): vscode.Uri | undefined {
  const uri = document.uri;
  if (uri.scheme === 'file') return uri;
  if (uri.scheme === 'untitled' || !uri.path) return undefined;
  const file = vscode.Uri.file(uri.path);
  return vscode.workspace.getWorkspaceFolder(file) ? file : undefined;
}
