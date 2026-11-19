import * as vscode from 'vscode';
import { PuzzleContext, PuzzleProvider, SubmitResult } from '../types';
import { markSolved } from './progress';
import { recordSubmission } from './submitHistory';

/**
 * Records what a fresh submit response means for progress.ts, and returns the
 * confirmed-correct answer text when one is now known. 'correct' already carries the
 * answer text — just save it. 'already-solved' does not: the site never repeats the
 * answer for a part you've already solved, so this tries to recover the real text from
 * the site itself instead of settling for "solved, unknown answer" — the same lookup the
 * tree's "Fetch Reference Answers from Site" backfill uses, just triggered immediately
 * instead of needing a separate manual pass. Best-effort: falls back to marking it
 * solved with no answer text (and returning undefined) if the site has no such lookup,
 * or it fails. Every judged submission also goes in the history (./submitHistory).
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
    await recordSubmission(state, provider, ctx, answer, result.status, result.message);
    await markSolved(state, provider, ctx, ctx.part, answer);
    return answer;
  }
  if (result.status !== 'already-solved') {
    await recordSubmission(state, provider, ctx, answer, result.status, result.message);
    return undefined;
  }

  let recovered: string | undefined;
  if (provider.fetchRecordedAnswers) {
    try {
      recovered = (await provider.fetchRecordedAnswers(ctx, token, contact))[ctx.part - 1];
    } catch {
      // best-effort — fall through to recording it solved with no answer text
    }
  }
  // Submitting the very answer the site has on record means it was right: say so in the
  // history too, rather than a neutral "already solved".
  const right = recovered !== undefined && recovered === answer.trim();
  await recordSubmission(state, provider, ctx, answer, right ? 'correct' : 'already-solved', result.message);
  await markSolved(state, provider, ctx, ctx.part, recovered);
  return recovered;
}

/** Appends the recorded answer to an "already solved" message, but only when it
 * reveals something you didn't already know — i.e. it differs from what you just
 * submitted. If a recorded answer already existed and disagreed with your guess,
 * guardSubmit would have warned you about that *before* this submission even went out;
 * this covers the first-time-discovery case, where nothing was recorded yet. */
export function describeSubmitResult(result: SubmitResult, submittedAnswer: string, recorded: string | undefined): string {
  if (result.status === 'already-solved' && recorded) {
    return recorded === submittedAnswer.trim()
      ? `${result.message} "${recorded}" is the right answer.`
      : `${result.message} (recorded answer: ${recorded})`;
  }
  return result.message;
}
