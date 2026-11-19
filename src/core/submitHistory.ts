import * as vscode from 'vscode';
import { PuzzleContext, PuzzleProvider, SubmitStatus } from '../types';
import { getRecordedAnswer, markSolved, unmarkSolved } from './progress';

/** 'copied': handed over for a site that can't be submitted to from here, outcome unknown. */
export type HistoryStatus = SubmitStatus | 'copied';

export interface HistoryEntry {
  answer: string;
  status: HistoryStatus;
  /** The site's own reply ("your answer is too high"), when there was one. */
  message?: string;
  /** ISO timestamp of the latest time this answer was sent. */
  at: string;
}

function historyKey(provider: PuzzleProvider, ctx: PuzzleContext): string {
  return `puzzleSubmitter.history.${provider.id}.${ctx.group}.${ctx.index}.${ctx.part}`;
}

/** This part's past submissions, newest first, one entry per distinct answer. */
export function getSubmissionHistory(state: vscode.Memento, provider: PuzzleProvider, ctx: PuzzleContext): HistoryEntry[] {
  return state.get<HistoryEntry[]>(historyKey(provider, ctx), []);
}

/** A rate-limited submission was never judged, so it isn't one: it's left out, and sending
 * that answer again later stays free of any prompt. */
export async function recordSubmission(
  state: vscode.Memento,
  provider: PuzzleProvider,
  ctx: PuzzleContext,
  answer: string,
  status: HistoryStatus,
  message?: string
): Promise<void> {
  if (status === 'rate-limited') return;
  const others = getSubmissionHistory(state, provider, ctx).filter((e) => e.answer !== answer.trim());
  const entry: HistoryEntry = { answer: answer.trim(), status, ...(message ? { message } : {}), at: new Date().toISOString() };
  await state.update(historyKey(provider, ctx), [entry, ...others]);
}

/** For a site without a submission API, where only you see what the site replied: marks a
 * copied answer right or wrong ('copied' again undoes it). Right marks the part solved with
 * it, which Submit then checks later answers against; undoing that unmarks the part. */
export async function setVerdict(
  state: vscode.Memento,
  provider: PuzzleProvider,
  ctx: PuzzleContext,
  answer: string,
  verdict: 'correct' | 'incorrect' | 'copied'
): Promise<void> {
  const history = getSubmissionHistory(state, provider, ctx);
  const updated = history.map((e) => (e.answer === answer ? { ...e, status: verdict } : e));
  await state.update(historyKey(provider, ctx), updated);
  if (verdict === 'correct') {
    await markSolved(state, provider, ctx, ctx.part, answer);
  } else if (getRecordedAnswer(state, provider, ctx, ctx.part) === answer) {
    await unmarkSolved(state, provider, ctx, ctx.part);
  }
}

/** The earlier submission of this very answer, if there was one. */
export function findPastSubmission(
  state: vscode.Memento,
  provider: PuzzleProvider,
  ctx: PuzzleContext,
  answer: string
): HistoryEntry | undefined {
  return getSubmissionHistory(state, provider, ctx).find((e) => e.answer === answer.trim());
}

/** Not scoped per-account, like progress.ts — see changeToken in ./accountSwitch. */
export function hasSubmissionHistory(state: vscode.Memento, provider: PuzzleProvider): boolean {
  const prefix = `puzzleSubmitter.history.${provider.id}.`;
  return state.keys().some((key) => key.startsWith(prefix));
}

export async function clearSubmissionHistory(state: vscode.Memento, provider: PuzzleProvider): Promise<void> {
  const prefix = `puzzleSubmitter.history.${provider.id}.`;
  for (const key of state.keys()) {
    if (key.startsWith(prefix)) await state.update(key, undefined);
  }
}

const OUTCOME: Record<HistoryStatus, string> = {
  correct: 'it was right',
  'already-solved': 'the part was already solved',
  incorrect: 'it was wrong',
  'rate-limited': 'it was rate-limited',
  unknown: 'the reply was unclear',
  copied: 'the result is unknown here',
};

/** One line on an earlier submission, for the confirmation before repeating it. */
export function describePastSubmission(entry: HistoryEntry): string {
  const when = new Date(entry.at).toLocaleString();
  return `"${entry.answer}" was already sent on ${when}: ${entry.message ?? OUTCOME[entry.status]}.`;
}
