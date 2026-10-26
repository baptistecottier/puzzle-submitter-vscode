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
 * there. Falls back to a plain toast for anything that isn't a SolverError. Deliberately
 * doesn't wait for the toast: a caller awaiting it would stay stuck until the user
 * dismissed it (the panel's Run button kept showing "Cancel" until then). */
export function showSolverError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (!(error instanceof SolverError) || !error.detail) {
    vscode.window.showErrorMessage(`Puzzle Submitter: ${message}`);
    return;
  }
  log(error.detail);
  void vscode.window.showErrorMessage(`Puzzle Submitter: ${message}`, 'Show Output').then((choice) => {
    if (choice === 'Show Output') getOutputChannel().show(true);
  });
}

/** Answers a solver's input() during an interactive run (see runPythonSolver's onInput):
 * what it printed since its last question goes to the output channel, shown without
 * taking focus, so the question has its context; then an input box asks. Escape gives
 * undefined, which cancels the run. */
export async function askForSolverInput(prompt: string, newOutput: string): Promise<string | undefined> {
  const channel = getOutputChannel();
  if (newOutput) channel.append(newOutput.endsWith('\n') ? newOutput : newOutput + '\n');
  channel.show(true);
  const lastPrinted = newOutput.trim().split('\n').pop();
  return vscode.window.showInputBox({
    title: 'Puzzle Submitter: solver() is asking for input()',
    prompt: prompt.trim() || lastPrinted || 'Its output so far is in the Puzzle Submitter output channel.',
    placeHolder: 'Your reply — Escape stops the run',
    ignoreFocusOut: true,
  });
}
