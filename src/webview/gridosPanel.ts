import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { PuzzleContext, PuzzleProvider } from '../types';
import { GRIDOS_TARGETS, GridosScores, GridosTarget, gridosPartDir, listGridosRules, parseGridosPart, runGridos } from '../core/gridos';
import { ensureLocalInput } from '../core/ensureInput';
import { readLocalInput } from '../core/localInput';
import { getRecordedAnswer, markSolved } from '../core/progress';
import { requireToken } from '../core/auth';
import { log } from '../core/output';
import { isGridosGroup, parseGridosBest, submitGridosProgram } from '../providers/everybodycodes';

interface FileRun {
  allPassed: boolean;
  passed: number;
  total: number;
  scores: GridosScores;
  /** The first failing case, as one line: "case 17: [ ERROR 404 ] Missing rule …". */
  failure?: string;
}

export interface GridosFileRow {
  name: string;
  path: string;
  target?: GridosTarget;
  /** The file the panel is on. */
  active: boolean;
  run?: FileRun;
}

export interface GridosPanelState {
  /** Official test cases cached for this part; undefined until they're fetched. */
  testCount?: number;
  files: GridosFileRow[];
  /** Your best scores as recorded on the site (any part solved there or here). */
  siteBest?: Partial<GridosScores>;
  running: boolean;
}

/** The panel's GridOS mode: instead of a solver() and an answer, a part folder holds one
 * .rules file per score being optimised (q1p1_heads.rules, q1p1_steps.rules, …). They all
 * run on the part's official test cases (fetched like any Everybody Codes input) with the
 * site's own engine, side by side, and each can be submitted. */
export class GridosPanel {
  private readonly runs = new Map<string, FileRun>();
  running = false;

  constructor(private readonly extensionContext: vscode.ExtensionContext) {}

  static applies(provider: PuzzleProvider | undefined, ctx: PuzzleContext | undefined): boolean {
    return provider?.id === 'everybodycodes' && Boolean(ctx && isGridosGroup(ctx.group));
  }

  /** The part's folder, from wherever the solution file sits in that quest. */
  partDir(solutionFile: string | undefined, ctx: PuzzleContext): string | undefined {
    return solutionFile ? gridosPartDir(solutionFile, ctx.part) : undefined;
  }

  private files(partDir: string | undefined, solutionFile: string | undefined): GridosFileRow[] {
    if (!partDir) return [];
    return listGridosRules(partDir).map((file) => ({ ...file, active: file.path === solutionFile, run: this.runs.get(file.path) }));
  }

  private cachedCases(folder: vscode.WorkspaceFolder, provider: PuzzleProvider, ctx: PuzzleContext): number | undefined {
    const text = readLocalInput(folder, provider.id, ctx)?.[String(ctx.part)];
    if (!text) return undefined;
    try {
      return parseGridosPart(text).cases.length;
    } catch {
      return undefined;
    }
  }

  state(
    folder: vscode.WorkspaceFolder,
    provider: PuzzleProvider,
    ctx: PuzzleContext,
    solutionFile: string | undefined
  ): GridosPanelState {
    const best = parseGridosBest(getRecordedAnswer(this.extensionContext.workspaceState, provider, ctx, ctx.part));
    return {
      testCount: this.cachedCases(folder, provider, ctx),
      files: this.files(this.partDir(solutionFile, ctx), solutionFile),
      ...(best ? { siteBest: best } : {}),
      running: this.running,
    };
  }

  /** Runs every .rules file of the part on its official test cases. A click fetches the
   * cases first if they're missing; a save never touches the network. */
  async run(
    folder: vscode.WorkspaceFolder,
    provider: PuzzleProvider,
    ctx: PuzzleContext,
    solutionFile: string | undefined,
    trigger: 'click' | 'save',
    onProgress: () => Promise<void>
  ): Promise<string | undefined> {
    const inputs =
      trigger === 'click'
        ? await ensureLocalInput(provider, ctx, folder, this.extensionContext.secrets)
        : readLocalInput(folder, provider.id, ctx);
    const text = inputs?.[String(ctx.part)];
    if (!text) return `No test cases for part ${ctx.part} yet — fetch them first (part ${ctx.part} unlocks once part ${ctx.part - 1} is solved).`;
    let part;
    try {
      part = parseGridosPart(text);
    } catch (error) {
      return `The cached input for part ${ctx.part} isn't GridOS test data: ${error instanceof Error ? error.message : String(error)}`;
    }

    const files = this.files(this.partDir(solutionFile, ctx), solutionFile);
    if (!files.length) return 'No .rules file in this part folder.';
    this.running = true;
    await onProgress();
    try {
      for (const file of files) {
        // Let the panel repaint between files — each one is a few milliseconds, but a
        // program that loops until the step limit can take a second or two.
        await new Promise((resolve) => setImmediate(resolve));
        const program = fs.readFileSync(file.path, 'utf8');
        const result = runGridos(program, part);
        const failed = result.cases.find((c) => !c.passed);
        const failure = failed
          ? `case ${failed.index}: ${failed.error ?? `output doesn't match (${failed.validate})`}`
          : undefined;
        this.runs.set(file.path, {
          allPassed: result.allPassed,
          passed: result.passed,
          total: result.cases.length,
          scores: result.scores,
          ...(failure ? { failure } : {}),
        });
        if (failed) {
          log(
            `GridOS ${file.name} — ${failure}\n` +
              (failed.error ? '' : `expected (${failed.validate}):\n${failed.expected}\ngot:\n${failed.output}`)
          );
        }
      }
    } finally {
      this.running = false;
    }
    return undefined;
  }

  /** Submits one file, after running it again: only a program passing every case is sent
   * (the site only submits those too), and one that beats none of your recorded best
   * scores is sent only if you confirm. Afterwards your best scores are read back. */
  async submit(
    folder: vscode.WorkspaceFolder,
    provider: PuzzleProvider,
    ctx: PuzzleContext,
    filePath: string
  ): Promise<{ status: string; message: string } | undefined> {
    const text = readLocalInput(folder, provider.id, ctx)?.[String(ctx.part)];
    if (!text) return { status: 'unknown', message: 'Fetch the test cases and run the file before submitting it.' };
    const program = fs.readFileSync(filePath, 'utf8');
    const result = runGridos(program, parseGridosPart(text));
    const name = path.basename(filePath);
    if (!result.allPassed) {
      const failed = result.cases.find((c) => !c.passed)!;
      return { status: 'incorrect', message: `${name} fails case ${failed.index} — not submitted.` };
    }
    const best = parseGridosBest(getRecordedAnswer(this.extensionContext.workspaceState, provider, ctx, ctx.part));
    const improves = !best || GRIDOS_TARGETS.some((t) => typeof best[t] === 'number' && result.scores[t] < best[t]);
    if (!improves) {
      const choice = await vscode.window.showWarningMessage(
        `${name} doesn't beat any of your recorded best scores for this part. Submit it anyway?`,
        { modal: true },
        'Submit'
      );
      if (choice !== 'Submit') return undefined;
    }

    const token = await requireToken(this.extensionContext.secrets, provider);
    if (!token) return undefined;
    log(`Submitting GridOS ${name} (${provider.label} ${ctx.group} quest ${ctx.index} part ${ctx.part})`);
    const submitted = await submitGridosProgram(ctx, token, program);
    log(`Result: ${submitted.status} — ${submitted.message}`);

    if (provider.fetchRecordedAnswers) {
      const contact = vscode.workspace.getConfiguration('puzzleSubmitter').get<string>('contact', '');
      try {
        const answers = await provider.fetchRecordedAnswers(ctx, token, contact);
        for (const [i, answer] of answers.entries()) {
          await markSolved(this.extensionContext.workspaceState, provider, { ...ctx, part: i + 1 }, i + 1, answer);
        }
      } catch (error) {
        log(`Couldn't read back your GridOS scores: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { status: submitted.status, message: `${name}: ${submitted.message}` };
  }
}
