import * as vscode from 'vscode';
import { PuzzleContext, PuzzleInputParts, PuzzleProvider } from '../types';
import { requireToken } from './auth';
import { readLocalInput, siteInputPath, writeLocalInput } from './localInput';
import { log } from './output';

/**
 * Local input for the requested part if it's already cached; otherwise, when the site
 * has a fetch API, fetches it automatically (prompting for a token if needed) and
 * caches it before returning. Returns undefined only when nothing is cached and either
 * there's no fetch API for this site (codyssi/i18n-puzzles/coding quest) or the fetch
 * itself didn't produce that part (not unlocked yet, fetch failed, token cancelled).
 */
export async function ensureLocalInput(
  provider: PuzzleProvider,
  ctx: PuzzleContext,
  folder: vscode.WorkspaceFolder,
  secrets: vscode.SecretStorage
): Promise<PuzzleInputParts | undefined> {
  const existing = readLocalInput(folder, provider.id, ctx);
  if (existing?.[String(ctx.part)]) return existing;

  if (!provider.fetchInput) return existing;

  const token = await requireToken(secrets, provider);
  if (!token) return existing;

  const contact = vscode.workspace.getConfiguration('puzzleSubmitter').get<string>('contact', '');
  try {
    const fetched = await provider.fetchInput(ctx, token, contact);
    writeLocalInput(folder, provider.id, ctx, fetched);
    log(`Saved input to ${siteInputPath(provider.id)} (auto-fetched before running solver)`);
  } catch (error) {
    vscode.window.showErrorMessage(
      `Puzzle Submitter: couldn't auto-fetch input: ${error instanceof Error ? error.message : String(error)}`
    );
    return existing;
  }
  return readLocalInput(folder, provider.id, ctx);
}
