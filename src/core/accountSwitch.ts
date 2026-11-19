import * as vscode from 'vscode';
import { PuzzleProvider } from '../types';
import { promptAndSaveToken } from './auth';
import { clearLocalInput } from './localInput';
import { clearProgress } from './progress';
import { clearSubmissionHistory } from './submitHistory';

/**
 * "Update" replaces the token of the same account (an expired cookie, say) and keeps
 * everything. "Switch account" also clears what belonged to the old account: neither the
 * cached input, nor recorded answers, nor the submission history is scoped per account,
 * so they'd otherwise show up as the new one's. Cancelling the token prompt changes nothing.
 */
export type TokenChange = 'update' | 'switch';

export async function changeToken(
  change: TokenChange,
  folder: vscode.WorkspaceFolder | undefined,
  provider: PuzzleProvider,
  secrets: vscode.SecretStorage,
  workspaceState: vscode.Memento
): Promise<boolean> {
  const token = await promptAndSaveToken(secrets, provider, change === 'switch' ? 'the other account' : undefined);
  if (!token) return false;
  if (change === 'update') {
    vscode.window.showInformationMessage(`Puzzle Submitter: token updated for ${provider.label}.`);
    return true;
  }
  if (folder) clearLocalInput(folder, provider.id);
  await clearProgress(workspaceState, provider);
  await clearSubmissionHistory(workspaceState, provider);
  vscode.window.showInformationMessage(
    `Puzzle Submitter: switched ${provider.label} account — the previous one's cached input, answers and submission history were cleared.`
  );
  return true;
}

/** For the command palette, where there's no pair of links: a token already set gets the
 * choice, a first one is just asked for. */
export async function pickTokenChange(hasToken: boolean): Promise<TokenChange | undefined> {
  if (!hasToken) return 'update';
  const picked = await vscode.window.showQuickPick(
    [
      { label: 'Update token', description: 'same account, e.g. the cookie expired', change: 'update' as const },
      { label: 'Switch account', description: "clears this site's cached input, answers and history", change: 'switch' as const },
    ],
    { title: 'A token is already set' }
  );
  return picked?.change;
}
