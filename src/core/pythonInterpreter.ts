import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

/**
 * Picks which `python` to run solver files with: an explicit
 * puzzleSubmitter.pythonPath setting, else this workspace's own .venv (matching how
 * this project's repos are actually set up — uv/venv, not a bare system interpreter),
 * else whatever `python3` is on PATH.
 */
export function resolvePythonInterpreter(folder: vscode.WorkspaceFolder): string {
  const configured = vscode.workspace.getConfiguration('puzzleSubmitter', folder).get<string>('pythonPath', '').trim();
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.join(folder.uri.fsPath, configured);
  }
  const venvPython = path.join(folder.uri.fsPath, '.venv', 'bin', 'python');
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }
  return 'python3';
}

/** How long a single preprocessing()/solver() run is allowed before it's killed — see
 * puzzleSubmitter.solverTimeoutSeconds. Matters most for bulk operations (Run All
 * Quests, Sync with Site), where one hung/infinite-looping solution shouldn't be able to
 * stall the whole run for minutes. */
export function resolveSolverTimeoutSeconds(folder: vscode.WorkspaceFolder): number {
  return vscode.workspace.getConfiguration('puzzleSubmitter', folder).get<number>('solverTimeoutSeconds', 60);
}
