import * as vscode from 'vscode';
import { PuzzleContext, PuzzleProvider } from '../types';
import { checkAgainstRecorded, getRecordedAnswer } from './progress';

export type SubmitGuardOutcome = 'proceed' | 'skip' | 'cancelled';

/**
 * Checks a candidate answer against any already-confirmed reference for this part before
 * it's sent over the network. A match means submitting again is pointless — the site
 * would just answer "already solved" without repeating anything useful — so the caller
 * should skip the request ('skip'). A mismatch against a *confirmed* answer is very
 * likely wrong (we already know the real one), so this confirms before spending a
 * submission attempt on it, since a wrong answer costs a real time penalty on sites like
 * Advent of Code ('cancelled' if declined). No reference at all — the common case —
 * proceeds without any prompt ('proceed').
 */
export async function guardSubmit(
  state: vscode.Memento,
  provider: PuzzleProvider,
  ctx: PuzzleContext,
  answer: string
): Promise<SubmitGuardOutcome> {
  const check = checkAgainstRecorded(state, provider, ctx, answer);
  if (check === 'no-reference') return 'proceed';
  if (check === 'match') return 'skip';

  const recorded = getRecordedAnswer(state, provider, ctx, ctx.part);
  const choice = await vscode.window.showWarningMessage(
    `Puzzle Submitter: the recorded answer for ${provider.itemNoun} ${ctx.index} part ${ctx.part} is "${recorded}", not "${answer}". Submit "${answer}" anyway?`,
    { modal: true },
    'Submit Anyway'
  );
  return choice === 'Submit Anyway' ? 'proceed' : 'cancelled';
}
