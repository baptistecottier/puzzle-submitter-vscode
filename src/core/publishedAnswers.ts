import * as vscode from 'vscode';
import { PuzzleContext, PuzzleProvider } from '../types';
import { getRecordedAnswer, markSolved } from './progress';

/** Answers a site publishes for everyone (see PuzzleProvider.fetchPublishedAnswers), kept
 * apart from the recorded ones: a recorded answer means you solved the part, a published
 * one is only something to check against — every puzzle has one. */
function key(provider: PuzzleProvider, ctx: PuzzleContext): string {
  return `puzzleSubmitter.published.${provider.id}.${ctx.group}.${ctx.index}`;
}

export function getPublishedAnswer(state: vscode.Memento, provider: PuzzleProvider, ctx: PuzzleContext, part: number): string | undefined {
  return state.get<string[]>(key(provider, ctx), [])[part - 1];
}

export async function storePublishedAnswers(
  state: vscode.Memento,
  provider: PuzzleProvider,
  ctx: PuzzleContext,
  answers: string[]
): Promise<void> {
  await state.update(key(provider, ctx), answers);
}

/** What a part's answer is checked against: the one you solved it with, else the
 * published one. */
export function referenceAnswer(
  state: vscode.Memento,
  provider: PuzzleProvider,
  ctx: PuzzleContext,
  part: number
): { answer: string; published: boolean } | undefined {
  const recorded = getRecordedAnswer(state, provider, ctx, part);
  if (recorded !== undefined) return { answer: recorded, published: false };
  const published = getPublishedAnswer(state, provider, ctx, part);
  return published !== undefined ? { answer: published, published: true } : undefined;
}

/** Whether an answer is right on a site with nothing to submit to, judged by its published
 * answer (fetched now if it isn't stored yet). A match counts as solving the part. */
export async function checkWithoutSubmitting(
  state: vscode.Memento,
  provider: PuzzleProvider,
  ctx: PuzzleContext,
  answer: string,
  contact: string
): Promise<'match' | 'mismatch' | undefined> {
  let reference = referenceAnswer(state, provider, ctx, ctx.part);
  if (!reference && provider.fetchPublishedAnswers) {
    try {
      const answers = await provider.fetchPublishedAnswers(ctx, contact);
      await storePublishedAnswers(state, provider, ctx, answers);
      reference = referenceAnswer(state, provider, ctx, ctx.part);
    } catch {
      // Archive unreachable: nothing to check against, the answer is just copied.
    }
  }
  if (!reference) return undefined;
  if (answer.trim() !== reference.answer.trim()) return 'mismatch';
  await markSolved(state, provider, ctx, ctx.part, reference.answer);
  return 'match';
}
