import * as vscode from 'vscode';
import { PuzzleContext, PuzzleProvider, SubmitResult } from '../types';
import { markSolved } from './progress';

/**
 * Records what a fresh submit response means for progress.ts, and returns the
 * confirmed-correct answer text when one is now known. 'correct' already carries the
 * answer text — just save it. 'already-solved' does not: the site never repeats the
 * answer for a part you've already solved, so this tries to recover the real text from
 * the site itself instead of settling for "solved, unknown answer" — the same lookup the
 * tree's "Fetch Reference Answers from Site" backfill uses, just triggered immediately
 * instead of needing a separate manual pass. Best-effort: falls back to marking it
 * solved with no answer text (and returning undefined) if the site has no such lookup,
 * or it fails. No-ops for any other status.
 */
export async function recordSubmitResult(
  state: vscode.Memento,
  provider: PuzzleProvider,
  ctx: PuzzleContext,
  answer: string,
  result: SubmitResult,
  token: string,
  contact: string
): Promise<string | undefined> {
  if (result.status === 'correct') {
    await markSolved(state, provider, ctx, ctx.part, answer);
    return answer;
  }
  if (result.status !== 'already-solved') return undefined;

  if (provider.fetchRecordedAnswers) {
    try {
      const answers = await provider.fetchRecordedAnswers(ctx, token, contact);
      const recovered = answers[ctx.part - 1];
      await markSolved(state, provider, ctx, ctx.part, recovered);
      return recovered;
    } catch {
      // best-effort — fall through to recording it solved with no answer text
    }
  }
  await markSolved(state, provider, ctx, ctx.part);
  return undefined;
}

/** Appends the recorded answer to an "already solved" message, but only when it
 * reveals something you didn't already know — i.e. it differs from what you just
 * submitted. If a recorded answer already existed and disagreed with your guess,
 * guardSubmit would have warned you about that *before* this submission even went out;
 * this covers the first-time-discovery case, where nothing was recorded yet. */
export function describeSubmitResult(result: SubmitResult, submittedAnswer: string, recorded: string | undefined): string {
  if (result.status === 'already-solved' && recorded && recorded !== submittedAnswer) {
    return `${result.message} (recorded answer: ${recorded})`;
  }
  return result.message;
}
