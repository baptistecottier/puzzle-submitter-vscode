import * as vscode from 'vscode';
import { PuzzleContext, PuzzleProvider, SubmitResult } from '../types';
import { markSolved } from './progress';

/**
 * Records what a fresh submit response means for progress.ts. 'correct' already carries
 * the answer text — just save it. 'already-solved' does not: the site never repeats the
 * answer for a part you've already solved, so this tries to recover the real text from
 * the site's own puzzle page instead of settling for "solved, unknown answer" — the same
 * lookup the tree's "Fetch Reference Answers from Site" backfill uses, just triggered
 * immediately instead of needing a separate manual pass. Best-effort: falls back to
 * marking it solved with no answer text if the site has no such lookup, or it fails.
 * No-ops for any other status.
 */
export async function recordSubmitResult(
  state: vscode.Memento,
  provider: PuzzleProvider,
  ctx: PuzzleContext,
  answer: string,
  result: SubmitResult,
  token: string,
  contact: string
): Promise<void> {
  if (result.status === 'correct') {
    await markSolved(state, provider, ctx, ctx.part, answer);
    return;
  }
  if (result.status !== 'already-solved') return;

  if (provider.fetchRecordedAnswers) {
    try {
      const answers = await provider.fetchRecordedAnswers(ctx, token, contact);
      await markSolved(state, provider, ctx, ctx.part, answers[ctx.part - 1]);
      return;
    } catch {
      // best-effort — fall through to recording it solved with no answer text
    }
  }
  await markSolved(state, provider, ctx, ctx.part);
}
