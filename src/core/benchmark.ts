import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { PuzzleContext, PuzzleProvider } from '../types';
import { readLocalInput } from './localInput';
import { runPythonSolver } from './pythonRunner';
import { markSolved } from './progress';
import { referenceAnswer } from './publishedAnswers';
import { GRIDOS_TARGETS, gridosPartDir, listGridosRules, parseGridosPart, runGridos } from './gridos';

export type PartBenchmark =
  | { status: 'match'; computed: string }
  | { status: 'mismatch'; computed: string; recorded: string }
  | { status: 'no-reference'; computed: string } // ran fine, nothing recorded to compare against
  | { status: 'no-input' } // nothing cached locally — deliberately not auto-fetched here
  | { status: 'error'; message: string };

/**
 * Runs solver() for one part and compares it against the locally-recorded correct
 * answer, if any — entirely offline, no network call, no submission. This is what
 * "Run all parts" / "Run all quests" does: a regression check against puzzles you've
 * already solved, not a way to submit in bulk (submitting stays a deliberate,
 * per-part action — see submitPart in extension.ts / panelProvider.ts).
 */
export async function benchmarkPart(
  provider: PuzzleProvider,
  ctx: PuzzleContext,
  solutionFile: string,
  pythonPath: string,
  timeoutSeconds: number,
  folder: vscode.WorkspaceFolder,
  workspaceState: vscode.Memento,
  cancelToken?: vscode.CancellationToken
): Promise<PartBenchmark> {
  if (!provider.solverInputShape) {
    return { status: 'error', message: `${provider.label} has no solver() runner.` };
  }
  if (cancelToken?.isCancellationRequested) {
    return { status: 'error', message: 'Cancelled.' };
  }
  const inputParts = readLocalInput(folder, provider.id, ctx);
  if (!inputParts?.[String(ctx.part)]) {
    return { status: 'no-input' };
  }

  try {
    let cancelSub: vscode.Disposable | undefined;
    const { parts } = await runPythonSolver(
      pythonPath,
      solutionFile,
      inputParts,
      provider.solverInputShape,
      ctx.part,
      folder.uri.fsPath,
      timeoutSeconds,
      (kill) => {
        cancelSub = cancelToken?.onCancellationRequested(kill);
      }
    ).finally(() => cancelSub?.dispose());
    const computed = parts[ctx.part - 1] ?? parts[0] ?? '';
    const reference = referenceAnswer(workspaceState, provider, ctx, ctx.part);
    if (!reference) {
      return { status: 'no-reference', computed };
    }
    // A published answer (the same for everyone) is compared leniently on surrounding
    // whitespace, and matching it is what solving the part means on such a site.
    const matches = reference.published ? computed.trim() === reference.answer.trim() : computed === reference.answer;
    if (matches && reference.published) await markSolved(workspaceState, provider, ctx, ctx.part, reference.answer);
    return matches ? { status: 'match', computed } : { status: 'mismatch', computed, recorded: reference.answer };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

/** A GridOS part's equivalent of benchmarkPart: every .rules file of the part folder runs on
 * the cached official test cases — "match" when all of them pass (with the best of each
 * score among them), the first failing file otherwise. Offline, like benchmarkPart. */
export function benchmarkGridosPart(
  provider: PuzzleProvider,
  ctx: PuzzleContext,
  fileInQuest: string,
  folder: vscode.WorkspaceFolder
): PartBenchmark {
  const text = readLocalInput(folder, provider.id, ctx)?.[String(ctx.part)];
  if (!text) return { status: 'no-input' };
  const partDir = gridosPartDir(fileInQuest, ctx.part);
  const files = partDir ? listGridosRules(partDir) : [];
  if (!files.length) return { status: 'error', message: 'no .rules file' };
  let part;
  try {
    part = parseGridosPart(text);
  } catch {
    return { status: 'error', message: "cached input isn't GridOS test data" };
  }
  const best: Record<string, number> = {};
  for (const file of files) {
    const result = runGridos(fs.readFileSync(file.path, 'utf8'), part);
    if (!result.allPassed) {
      const failed = result.cases.find((c) => !c.passed)!;
      return { status: 'error', message: `${file.name} fails case ${failed.index}` };
    }
    for (const key of GRIDOS_TARGETS) best[key] = Math.min(best[key] ?? Infinity, result.scores[key]);
  }
  return { status: 'match', computed: `H${best.heads} S${best.states} R${best.rules} St${best.steps}` };
}
