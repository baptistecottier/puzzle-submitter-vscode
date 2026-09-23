import * as vscode from 'vscode';
import { PuzzleContext, PuzzleProvider } from '../types';

/** Per part: the confirmed-correct answer text (from a fresh 'correct' submission), or
 * `true` when we know it's solved but don't have a confirmed answer to benchmark
 * against (e.g. an 'already-solved' result, where this run's guess wasn't necessarily
 * the one that actually solved it). */
export type PartAnswers = Record<string, string | true>;

function progressKey(provider: PuzzleProvider, ctx: PuzzleContext): string {
  return `puzzleSubmitter.progress.${provider.id}.${ctx.group}.${ctx.index}`;
}

/** Understands both the current Record<part, answer> shape and the older number[]
 * shape (parts solved, no answer text) it replaced, so nothing recorded during
 * earlier use of this extension is lost. */
function readRaw(state: vscode.Memento, key: string): PartAnswers {
  const raw = state.get<unknown>(key, {});
  if (Array.isArray(raw)) {
    const converted: PartAnswers = {};
    for (const part of raw) converted[String(part)] = true;
    return converted;
  }
  return (raw && typeof raw === 'object' ? raw : {}) as PartAnswers;
}

export function getRecordedAnswers(state: vscode.Memento, provider: PuzzleProvider, ctx: PuzzleContext): PartAnswers {
  return readRaw(state, progressKey(provider, ctx));
}

export function getSolvedParts(state: vscode.Memento, provider: PuzzleProvider, ctx: PuzzleContext): number[] {
  return Object.keys(getRecordedAnswers(state, provider, ctx))
    .map(Number)
    .sort((a, b) => a - b);
}

/** The confirmed-correct answer text for one part, if we have one — not just "solved". */
export function getRecordedAnswer(
  state: vscode.Memento,
  provider: PuzzleProvider,
  ctx: PuzzleContext,
  part: number
): string | undefined {
  const value = getRecordedAnswers(state, provider, ctx)[String(part)];
  return typeof value === 'string' ? value : undefined;
}

/** Marks a part solved. Pass `answer` for a fresh 'correct' result (the confirmed-correct
 * text); omit it for 'already-solved' (this run's guess wasn't necessarily the one that
 * solved it) — an existing confirmed answer is kept, never downgraded to "unknown". */
export async function markSolved(
  state: vscode.Memento,
  provider: PuzzleProvider,
  ctx: PuzzleContext,
  part: number,
  answer?: string
): Promise<void> {
  const existing = getRecordedAnswers(state, provider, ctx);
  const current = existing[String(part)];
  const value = answer ?? (typeof current === 'string' ? current : true);
  await state.update(progressKey(provider, ctx), { ...existing, [String(part)]: value });
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
    const parts = Object.keys(readRaw(state, key))
      .map(Number)
      .sort((a, b) => a - b);
    if (parts.length === 0) continue;
    results.push({ group: remainder.slice(0, dotIndex), index: remainder.slice(dotIndex + 1), parts });
  }
  results.sort((a, b) => Number(a.index) - Number(b.index));
  return results;
}
