import * as vscode from 'vscode';
import { PuzzleContext, PuzzleProvider } from '../types';
import { readLocalInput } from './localInput';
import { runPythonSolver } from './pythonRunner';
import { getRecordedAnswer } from './progress';

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
  folder: vscode.WorkspaceFolder,
  workspaceState: vscode.Memento
): Promise<PartBenchmark> {
  if (!provider.solverInputShape) {
    return { status: 'error', message: `${provider.label} has no solver() runner.` };
  }
  const inputParts = readLocalInput(folder, provider.id, ctx);
  if (!inputParts?.[String(ctx.part)]) {
    return { status: 'no-input' };
  }

  try {
    const { parts } = await runPythonSolver(
      pythonPath,
      solutionFile,
      inputParts,
      provider.solverInputShape,
      ctx.part,
      folder.uri.fsPath
    );
    const computed = parts[ctx.part - 1] ?? parts[0] ?? '';
    const recorded = getRecordedAnswer(workspaceState, provider, ctx, ctx.part);
    if (recorded === undefined) {
      return { status: 'no-reference', computed };
    }
    return computed === recorded
      ? { status: 'match', computed }
      : { status: 'mismatch', computed, recorded };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}
