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

export interface SolvedPuzzle {
  group: string;
  index: string;
  parts: number[];
}

/** Every puzzle this workspace has marked at least one solved part for, for this provider. */
export function listSolvedPuzzles(state: vscode.Memento, provider: PuzzleProvider): SolvedPuzzle[] {
  const prefix = `puzzleSubmitter.progress.${provider.id}.`;
  const results: SolvedPuzzle[] = [];
  for (const key of state.keys()) {
    if (!key.startsWith(prefix)) continue;
    const remainder = key.slice(prefix.length);
    const dotIndex = remainder.indexOf('.');
    if (dotIndex === -1) continue;
    const parts = state.get<number[]>(key, []);
    if (parts.length === 0) continue;
    results.push({ group: remainder.slice(0, dotIndex), index: remainder.slice(dotIndex + 1), parts });
  }
  results.sort((a, b) => Number(a.index) - Number(b.index));
  return results;
}
