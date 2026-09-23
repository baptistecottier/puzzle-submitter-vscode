import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('Puzzle Submitter');
  }
  return channel;
}

export function log(message: string): void {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  getOutputChannel().appendLine(line);
}
