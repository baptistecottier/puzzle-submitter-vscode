import * as vscode from 'vscode';
import { SolverError } from './pythonRunner';

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

/** Shows a solver failure as a short, one-line notification — a full traceback (or the
 * solution's own prints up to the point it crashed/was killed) is unreadable crammed
 * into a VS Code toast, so it goes to the output channel instead, with a button to jump
 * there. Falls back to a plain toast for anything that isn't a SolverError. */
export async function showSolverError(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  if (!(error instanceof SolverError) || !error.detail) {
    vscode.window.showErrorMessage(`Puzzle Submitter: ${message}`);
    return;
  }
  log(error.detail);
  const choice = await vscode.window.showErrorMessage(`Puzzle Submitter: ${message}`, 'Show Output');
  if (choice === 'Show Output') getOutputChannel().show(true);
}
