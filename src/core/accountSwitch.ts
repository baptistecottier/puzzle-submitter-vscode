import * as vscode from 'vscode';
import { PuzzleProvider } from '../types';
import { hasLocalInput, clearLocalInput } from './localInput';
import { listSolvedPuzzles, clearProgress } from './progress';

/**
 * Called right after explicitly setting a new token — not on requireToken's silent
 * fallback for an unrelated action, only when the user deliberately went through "Set
 * Token". Neither the local input cache nor recorded progress is scoped per-account, so
 * switching to a different account's token (e.g. a demo account) would otherwise keep
 * showing the previous account's cached input and solved/answer state as if it belonged
 * to the new one. Silently does nothing if there's no local data to clear, so this never
 * bothers a genuine first-time setup.
 */
export async function offerToClearStaleData(
  folder: vscode.WorkspaceFolder,
  provider: PuzzleProvider,
  workspaceState: vscode.Memento
): Promise<void> {
  const inputCached = hasLocalInput(folder, provider.id);
  const solvedCount = listSolvedPuzzles(workspaceState, provider).length;
  if (!inputCached && solvedCount === 0) return;

  const choice = await vscode.window.showWarningMessage(
    `Puzzle Submitter: clear locally cached input and recorded answers for ${provider.label} in this workspace? Useful when this token is for a different account — the old data doesn't apply to it and can look wrong (stale input, answers that aren't actually solved on this account).`,
    { modal: true },
    'Clear Data'
  );
  if (choice !== 'Clear Data') return;

  if (inputCached) clearLocalInput(folder, provider.id);
  if (solvedCount > 0) await clearProgress(workspaceState, provider);
  vscode.window.showInformationMessage(`Puzzle Submitter: cleared local ${provider.label} data for this workspace.`);
}
