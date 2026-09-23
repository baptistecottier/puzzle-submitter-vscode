import * as vscode from 'vscode';
import { PuzzleContext, PuzzleProvider } from '../types';

function progressKey(provider: PuzzleProvider, ctx: PuzzleContext): string {
  return `puzzleSubmitter.progress.${provider.id}.${ctx.group}.${ctx.index}`;
}

export function getSolvedParts(state: vscode.Memento, provider: PuzzleProvider, ctx: PuzzleContext): number[] {
  return state.get<number[]>(progressKey(provider, ctx), []);
}

export async function markSolved(
  state: vscode.Memento,
  provider: PuzzleProvider,
  ctx: PuzzleContext,
  part: number
): Promise<void> {
  const solved = new Set(getSolvedParts(state, provider, ctx));
  solved.add(part);
  await state.update(progressKey(provider, ctx), [...solved].sort());
}

/** First part not yet marked solved, defaulting to the provider's last part once everything else is done. */
export function nextUnsolvedPart(state: vscode.Memento, provider: PuzzleProvider, ctx: PuzzleContext): number {
  const solved = new Set(getSolvedParts(state, provider, ctx));
  for (let part = 1; part <= provider.maxPart; part++) {
    if (!solved.has(part)) {
      return part;
    }
  }
  return provider.maxPart;
}
