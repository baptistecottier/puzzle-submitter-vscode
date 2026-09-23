import * as vscode from 'vscode';
import { PuzzleProvider } from '../types';
import { providers } from '../providers';

let item: vscode.StatusBarItem | undefined;

export function getStatusBarItem(): vscode.StatusBarItem {
  if (!item) {
    item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    item.command = 'puzzleSubmitter.submitAnswer';
  }
  return item;
}

/** Updates the status bar from the active editor, without prompting for anything unset. */
export function refreshStatusBar(editor: vscode.TextEditor | undefined): void {
  const bar = getStatusBarItem();
  const workspaceFolder = editor && vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (!editor || !workspaceFolder) {
    bar.hide();
    return;
  }

  const siteId = vscode.workspace.getConfiguration('puzzleSubmitter', workspaceFolder).get<string>('site');
  const provider: PuzzleProvider | undefined = siteId ? providers[siteId as keyof typeof providers] : undefined;
  if (!provider) {
    bar.text = '$(question) Puzzle Submitter';
    bar.tooltip = 'No site configured for this workspace yet — click to submit and set one up.';
    bar.show();
    return;
  }

  const relativePath = vscode.workspace.asRelativePath(editor.document.uri, false);
  const ctx = provider.detect(relativePath);
  if (!ctx) {
    bar.text = `$(circle-slash) ${provider.label}`;
    bar.tooltip = 'Could not detect a puzzle from the active file — click to submit and pick one manually.';
    bar.show();
    return;
  }

  const groupLabel = ctx.group ? `${ctx.group} · ` : '';
  bar.text = `$(cloud-upload) ${provider.label} · ${groupLabel}${ctx.index} (part ${ctx.part})`;
  bar.tooltip = 'Submit this answer';
  bar.show();
}
