import * as vscode from 'vscode';
import { PuzzleContext, PuzzleProvider } from '../types';
import { providers } from '../providers';
import { peekSite } from '../core/siteResolver';
import { canRunSolver, runPythonSolver } from '../core/pythonRunner';
import { maxPartFor } from '../core/puzzleParts';
import { resolvePythonInterpreter, resolveSolverTimeoutSeconds } from '../core/pythonInterpreter';
import { ensureLocalInput } from '../core/ensureInput';
import { benchmarkPart, PartBenchmark } from '../core/benchmark';
import { requireToken } from '../core/auth';
import { getRecordedAnswer, markSolved } from '../core/progress';
import { guardSubmit } from '../core/submitGuard';
import { recordSubmitResult } from '../core/submitRecorder';
import { log } from '../core/output';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface QuestEntry {
  filePath: string;
}

export type TreeNode =
  | { kind: 'event'; group: string }
  | { kind: 'quest'; group: string; index: string; filePath: string }
  | { kind: 'part'; group: string; index: string; part: number; filePath: string };

function partKey(group: string, index: string, part: number): string {
  return `${group} ${index} ${part}`;
}

function questKey(group: string, index: string): string {
  return `${group} ${index}`;
}

type Tally = { match: number; mismatch: number; other: number };

/**
 * Browsable event → quest → part tree, populated by scanning the workspace for .py
 * files the current site's provider recognizes (not from any "list all puzzles" API —
 * none exists uniformly). "Run all" at the quest/event level is a local, offline
 * benchmark against recorded answers (see core/benchmark.ts) — never a submission.
 * Submitting stays a deliberate, per-part action (submitPart below), on purpose: see
 * the plan this was built from for why batch-submitting isn't offered.
 */
export class PuzzleTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private provider: PuzzleProvider | undefined;
  private folder: vscode.WorkspaceFolder | undefined;
  private quests = new Map<string, Map<string, QuestEntry>>(); // group -> index -> entry
  private partResults = new Map<string, PartBenchmark>();
  private questResults = new Map<string, Tally>(); // last "Run All Parts" summary, keyed by questKey

  constructor(private readonly extensionContext: vscode.ExtensionContext) {}

  async refresh(): Promise<void> {
    await this.rescan();
    this._onDidChangeTreeData.fire();
  }

  private async rescan(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    this.folder =
      (editor && vscode.workspace.getWorkspaceFolder(editor.document.uri)) ?? vscode.workspace.workspaceFolders?.[0];
    const siteId = this.folder ? peekSite(this.folder) : undefined;
    this.provider = siteId ? providers[siteId] : undefined;
    this.quests.clear();
    // Deliberately not clearing partResults here — a plain refresh (e.g. active editor
    // changed) shouldn't wipe benchmark/submit icons from earlier in the session.
    if (!this.provider || !this.folder) return;

    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(this.folder, '**/*.py'),
      new vscode.RelativePattern(this.folder, '**/{.venv,node_modules,__pycache__}/**')
    );
    for (const file of files) {
      const relative = vscode.workspace.asRelativePath(file, false);
      const ctx = this.provider.detect(relative);
      if (!ctx) continue;
      if (!this.quests.has(ctx.group)) this.quests.set(ctx.group, new Map());
      const perGroup = this.quests.get(ctx.group);
      if (perGroup && !perGroup.has(ctx.index)) perGroup.set(ctx.index, { filePath: file.fsPath });
    }
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (!this.provider) return new vscode.TreeItem('');

    if (node.kind === 'event') {
      const item = new vscode.TreeItem(this.groupLabel(node.group), vscode.TreeItemCollapsibleState.Collapsed);
      item.contextValue = 'puzzleSubmitter.event';
      const summary = this.eventTally(node.group);
      if (summary) {
        item.description = `${this.describeTally(summary.tally)} · ${summary.ran}/${summary.total} run`;
        item.iconPath = this.iconForTally(summary.tally);
      }
      return item;
    }

    if (node.kind === 'quest') {
      const item = new vscode.TreeItem(
        `${this.provider.itemNoun} ${node.index}`,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      const ctx: PuzzleContext = { group: node.group, index: node.index, part: 1 };
      item.contextValue = canRunSolver(this.provider, ctx, node.filePath)
        ? 'puzzleSubmitter.quest'
        : 'puzzleSubmitter.quest.readonly';
      item.resourceUri = vscode.Uri.file(node.filePath);
      item.command = { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(node.filePath)] };
      const tally = this.questResults.get(questKey(node.group, node.index));
      if (tally) {
        item.description = this.describeTally(tally);
        item.iconPath = this.iconForTally(tally);
      }
      return item;
    }

    const result = this.partResults.get(partKey(node.group, node.index, node.part));
    const item = new vscode.TreeItem(`Part ${node.part}`, vscode.TreeItemCollapsibleState.None);
    item.iconPath = this.iconFor(result);
    item.description = this.descriptionFor(result);
    item.contextValue = this.provider.submit ? 'puzzleSubmitter.part' : 'puzzleSubmitter.part.readonly';
    return item;
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (!this.provider) return [];

    if (!node) {
      return [...this.quests.keys()].sort().map((group) => ({ kind: 'event', group }) satisfies TreeNode);
    }
    if (node.kind === 'event') {
      const perGroup = this.quests.get(node.group) ?? new Map<string, QuestEntry>();
      return [...perGroup.entries()]
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([index, entry]) => ({ kind: 'quest', group: node.group, index, filePath: entry.filePath }) satisfies TreeNode);
    }
    if (node.kind === 'quest') {
      const max = maxPartFor(this.provider, { group: node.group, index: node.index, part: 1 });
      return Array.from(
        { length: max },
        (_, i) => ({ kind: 'part', group: node.group, index: node.index, part: i + 1, filePath: node.filePath }) satisfies TreeNode
      );
    }
    return [];
  }

  private groupLabel(group: string): string {
    if (!this.provider) return group;
    if (this.provider.groupLabel) return this.provider.groupLabel(group);
    return group || '(ungrouped)';
  }

  private iconFor(result: PartBenchmark | undefined): vscode.ThemeIcon {
    switch (result?.status) {
      case 'match':
        return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
      case 'mismatch':
        return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
      case 'no-reference':
        return new vscode.ThemeIcon('circle-outline');
      case 'no-input':
        return new vscode.ThemeIcon('circle-slash');
      case 'error':
        return new vscode.ThemeIcon('warning');
      default:
        return new vscode.ThemeIcon('circle-large-outline');
    }
  }

  private descriptionFor(result: PartBenchmark | undefined): string | undefined {
    switch (result?.status) {
      case 'match':
        return result.computed;
      case 'mismatch':
        return `${result.computed} ≠ ${result.recorded}`;
      case 'no-reference':
        return result.computed;
      case 'no-input':
        return 'no local input';
      case 'error':
        return result.message;
      default:
        return undefined;
    }
  }

  /** Sums cached per-quest tallies for an event, so its row shows a result even collapsed. */
  private eventTally(group: string): { tally: Tally; ran: number; total: number } | undefined {
    const perGroup = this.quests.get(group);
    if (!perGroup || perGroup.size === 0) return undefined;
    const tally: Tally = { match: 0, mismatch: 0, other: 0 };
    let ran = 0;
    for (const index of perGroup.keys()) {
      const questTally = this.questResults.get(questKey(group, index));
      if (!questTally) continue;
      ran++;
      tally.match += questTally.match;
      tally.mismatch += questTally.mismatch;
      tally.other += questTally.other;
    }
    return ran > 0 ? { tally, ran, total: perGroup.size } : undefined;
  }

  private describeTally(tally: Tally): string {
    const total = tally.match + tally.mismatch + tally.other;
    if (tally.mismatch > 0) return `${tally.match}/${total} match, ${tally.mismatch} mismatch`;
    if (tally.match === total) return `${total}/${total} match`;
    return `${tally.match}/${total} match, ${tally.other} unverified`;
  }

  private iconForTally(tally: Tally): vscode.ThemeIcon {
    const total = tally.match + tally.mismatch + tally.other;
    if (tally.mismatch > 0) return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
    if (total > 0 && tally.match === total) return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
    return new vscode.ThemeIcon('circle-outline');
  }

  // ---- actions, wired to context-menu commands in extension.ts ----

  /** Benchmarks every part of one quest, locally, no network — see class doc. Runs under
   * a progress notification so clicking the tree's play icon has immediate visible
   * feedback instead of appearing to do nothing until the final summary pops up. */
  async benchmarkQuest(node: Extract<TreeNode, { kind: 'quest' }>): Promise<void> {
    if (!this.provider || !this.folder) return;
    const label = `${this.provider.itemNoun} ${node.index}`;
    const tally = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Puzzle Submitter: benchmarking ${label}…` },
      () => this.benchmarkOneQuest(node.group, node.index, node.filePath)
    );
    this._onDidChangeTreeData.fire();
    this.reportTally(label, tally);
  }

  /** Benchmarks every quest under one event — the tree's "Run all quests" action. */
  async benchmarkEvent(node: Extract<TreeNode, { kind: 'event' }>): Promise<void> {
    if (!this.provider || !this.folder) return;
    const perGroup = this.quests.get(node.group) ?? new Map<string, QuestEntry>();
    const label = this.groupLabel(node.group);
    const totals: Tally = { match: 0, mismatch: 0, other: 0 };
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Puzzle Submitter: benchmarking ${label}…` },
      async (progress) => {
        let done = 0;
        for (const [index, entry] of perGroup) {
          const tally = await this.benchmarkOneQuest(node.group, index, entry.filePath);
          totals.match += tally.match;
          totals.mismatch += tally.mismatch;
          totals.other += tally.other;
          done++;
          progress.report({ message: `${this.provider!.itemNoun} ${index} (${done}/${perGroup.size})`, increment: 100 / perGroup.size });
        }
      }
    );
    this._onDidChangeTreeData.fire();
    this.reportTally(label, totals);
  }

  /** Reads back confirmed-correct answers straight from the site's own puzzle page (aoc:
   * "Your puzzle answer was ..."), for every quest in this event — including ones solved
   * long before this extension ever recorded anything. Unlike benchmarking, this needs no
   * local solver at all; unlike re-submitting, it actually gets the answer text back,
   * since an "already solved" submit response never repeats it. Only sites that implement
   * fetchRecordedAnswers support this (aoc, for now). */
  async backfillEvent(node: Extract<TreeNode, { kind: 'event' }>): Promise<void> {
    if (!this.provider || !this.folder) return;
    const provider = this.provider;
    const fetchRecordedAnswers = provider.fetchRecordedAnswers;
    if (!fetchRecordedAnswers) {
      vscode.window.showInformationMessage(
        `${provider.label} has no known way to read back already-solved answers from the site.`
      );
      return;
    }
    const perGroup = this.quests.get(node.group) ?? new Map<string, QuestEntry>();
    if (perGroup.size === 0) return;

    const token = await requireToken(this.extensionContext.secrets, provider);
    if (!token) return;
    const contact = vscode.workspace.getConfiguration('puzzleSubmitter').get<string>('contact', '');
    const label = this.groupLabel(node.group);
    const indexes = [...perGroup.keys()].sort((a, b) => Number(a) - Number(b));

    let found = 0;
    let filled = 0;
    let aborted = false;

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Puzzle Submitter: reading recorded answers for ${label} from ${provider.label}…` },
      async (progress) => {
        for (let i = 0; i < indexes.length; i++) {
          const index = indexes[i];
          const ctx: PuzzleContext = { group: node.group, index, part: 1 };
          try {
            const answers = await fetchRecordedAnswers(ctx, token, contact);
            for (let p = 0; p < answers.length; p++) {
              const part = p + 1;
              const already = getRecordedAnswer(this.extensionContext.workspaceState, provider, ctx, part);
              if (already === undefined) filled++;
              found++;
              await markSolved(this.extensionContext.workspaceState, provider, { ...ctx, part }, part, answers[p]);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log(`Backfill: ${label} ${provider.itemNoun} ${index}: ${message}`);
            // A failure on the very first request is almost certainly a bad/expired
            // token — the rest would just repeat the same error. A later one is more
            // likely puzzle-specific (not unlocked, transient network blip); skip it and
            // keep going rather than losing everything found so far.
            if (i === 0) {
              vscode.window.showErrorMessage(`Puzzle Submitter: ${message}`);
              aborted = true;
              return;
            }
          }
          progress.report({ message: `${provider.itemNoun} ${index} (${i + 1}/${indexes.length})`, increment: 100 / indexes.length });
          if (i < indexes.length - 1) await sleep(300); // be polite to the site — this is 1 GET per quest, not answer submission
        }
      }
    );

    this._onDidChangeTreeData.fire();
    if (!aborted) {
      vscode.window.showInformationMessage(`${label}: found ${found} recorded answer(s) on ${provider.label} (${filled} new).`);
    }
  }

  /**
   * The one-click "make everything consistent with the site" action, across every event
   * currently in the tree, not just one: for each quest, fetches input if it's missing,
   * fetches reference answers if any part is missing one (see backfillEvent), then runs
   * the solver and compares (see benchmarkOneQuest) — the full pipeline in one pass
   * instead of fetching/backfilling/benchmarking by hand, event by event, year by year.
   * Anything already cached is skipped, so a repeat sync is cheap. Sites with no
   * network API at all (codyssi, i18n-puzzles, coding quest) still get the benchmark
   * pass, across every event at once, without any token prompt.
   */
  async syncWithSite(): Promise<void> {
    if (!this.provider || !this.folder) return;
    const provider = this.provider;
    const folder = this.folder;
    const state = this.extensionContext.workspaceState;

    const jobs: { group: string; index: string; filePath: string }[] = [];
    for (const [group, perGroup] of this.quests) {
      for (const [index, entry] of perGroup) {
        jobs.push({ group, index, filePath: entry.filePath });
      }
    }
    if (jobs.length === 0) {
      vscode.window.showInformationMessage('Puzzle Submitter: no quests found in this workspace to sync.');
      return;
    }

    const needsNetwork = Boolean(provider.fetchInput || provider.fetchRecordedAnswers);
    let token: string | undefined;
    if (needsNetwork) {
      token = await requireToken(this.extensionContext.secrets, provider);
      if (!token) return;
    }
    const contact = vscode.workspace.getConfiguration('puzzleSubmitter').get<string>('contact', '');

    const totals: Tally = { match: 0, mismatch: 0, other: 0 };
    let aborted = false;
    let anyNetworkSucceeded = false;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Puzzle Submitter: syncing ${provider.label} with the site…`,
        cancellable: true,
      },
      async (progress, cancelToken) => {
        for (let i = 0; i < jobs.length; i++) {
          if (cancelToken.isCancellationRequested) {
            aborted = true;
            return;
          }
          const { group, index, filePath } = jobs[i];
          const ctx: PuzzleContext = { group, index, part: 1 };
          progress.report({
            message: `${this.groupLabel(group)} ${provider.itemNoun} ${index} (${i + 1}/${jobs.length})`,
            increment: 100 / jobs.length,
          });

          if (token && provider.fetchInput) {
            try {
              await ensureLocalInput(provider, ctx, folder, this.extensionContext.secrets);
              anyNetworkSucceeded = true;
            } catch (error) {
              log(`Sync: input fetch failed for ${group} ${index}: ${error instanceof Error ? error.message : String(error)}`);
            }
            await sleep(300);
          }

          if (token && provider.fetchRecordedAnswers) {
            const stillMissing = Array.from({ length: maxPartFor(provider, ctx) }, (_, p) => p + 1).some(
              (part) => getRecordedAnswer(state, provider, ctx, part) === undefined
            );
            if (stillMissing) {
              try {
                const answers = await provider.fetchRecordedAnswers(ctx, token, contact);
                for (let p = 0; p < answers.length; p++) {
                  await markSolved(state, provider, { ...ctx, part: p + 1 }, p + 1, answers[p]);
                }
                anyNetworkSucceeded = true;
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                log(`Sync: reference fetch failed for ${group} ${index}: ${message}`);
                // Same "first failure is probably a bad token" heuristic as backfillEvent
                // — but only before anything has ever succeeded this run, since a prior
                // successful fetch already proves the token is fine.
                if (!anyNetworkSucceeded) {
                  vscode.window.showErrorMessage(`Puzzle Submitter: ${message}`);
                  aborted = true;
                  return;
                }
              }
              await sleep(300);
            }
          }

          const tally = await this.benchmarkOneQuest(group, index, filePath);
          totals.match += tally.match;
          totals.mismatch += tally.mismatch;
          totals.other += tally.other;
        }
      }
    );

    this._onDidChangeTreeData.fire();
    if (!aborted) {
      vscode.window.showInformationMessage(
        `Sync complete: ${this.describeTally(totals)} across ${jobs.length} ${provider.itemNoun.toLowerCase()}(s).`
      );
    }
  }

  private async benchmarkOneQuest(group: string, index: string, filePath: string): Promise<Tally> {
    const tally: Tally = { match: 0, mismatch: 0, other: 0 };
    if (!this.provider || !this.folder) return tally;
    const pythonPath = resolvePythonInterpreter(this.folder);
    const timeoutSeconds = resolveSolverTimeoutSeconds(this.folder);
    const max = maxPartFor(this.provider, { group, index, part: 1 });
    for (let part = 1; part <= max; part++) {
      const ctx: PuzzleContext = { group, index, part };
      const result = canRunSolver(this.provider, ctx, filePath)
        ? await benchmarkPart(
            this.provider,
            ctx,
            filePath,
            pythonPath,
            timeoutSeconds,
            this.folder,
            this.extensionContext.workspaceState
          )
        : ({ status: 'error', message: `${this.provider.label} has no solver() runner for this quest.` } as PartBenchmark);
      this.partResults.set(partKey(group, index, part), result);
      if (result.status === 'match') tally.match++;
      else if (result.status === 'mismatch') tally.mismatch++;
      else tally.other++;
    }
    this.questResults.set(questKey(group, index), tally);
    return tally;
  }

  private reportTally(label: string, tally: Tally): void {
    const summary = `${label}: ${tally.match} match, ${tally.mismatch} mismatch, ${tally.other} unverified.`;
    if (tally.mismatch > 0) {
      vscode.window.showWarningMessage(summary);
    } else {
      vscode.window.showInformationMessage(summary);
    }
  }

  /** The one deliberate way to actually submit from the tree — always a single part,
   * never triggered by benchmarkQuest/benchmarkEvent above. */
  async submitPart(node: Extract<TreeNode, { kind: 'part' }>): Promise<void> {
    if (!this.provider || !this.folder) return;
    const provider = this.provider;
    const submit = provider.submit;
    if (!submit) return;
    const folder = this.folder;
    const ctx: PuzzleContext = { group: node.group, index: node.index, part: node.part };

    const cached = this.partResults.get(partKey(node.group, node.index, node.part));
    let prefill: string | undefined = cached && 'computed' in cached ? cached.computed : undefined;

    if (prefill === undefined && canRunSolver(provider, ctx, node.filePath)) {
      prefill = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Puzzle Submitter: preparing answer for ${provider.itemNoun} ${node.index} part ${node.part}…` },
        async () => {
          const inputParts = await ensureLocalInput(provider, ctx, folder, this.extensionContext.secrets);
          if (!inputParts?.[String(node.part)] || !provider.solverInputShape) return undefined;
          try {
            const pythonPath = resolvePythonInterpreter(folder);
            const { parts } = await runPythonSolver(
              pythonPath,
              node.filePath,
              inputParts,
              provider.solverInputShape,
              node.part,
              folder.uri.fsPath,
              resolveSolverTimeoutSeconds(folder)
            );
            return parts[node.part - 1] ?? parts[0];
          } catch (error) {
            vscode.window.showErrorMessage(`Puzzle Submitter: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
          }
        }
      );
    }

    const answer = await vscode.window.showInputBox({
      title: `Submit — ${provider.itemNoun} ${node.index} part ${node.part}`,
      value: prefill,
      ignoreFocusOut: true,
    });
    if (!answer) return;

    const guard = await guardSubmit(this.extensionContext.workspaceState, provider, ctx, answer);
    if (guard === 'cancelled') return;
    if (guard === 'skip') {
      vscode.window.showInformationMessage(
        `"${answer}" already matches the recorded answer for ${provider.itemNoun} ${node.index} part ${node.part} — not submitting again.`
      );
      return;
    }

    const token = await requireToken(this.extensionContext.secrets, provider);
    if (!token) return;
    const contact = vscode.workspace.getConfiguration('puzzleSubmitter').get<string>('contact', '');

    log(`Submitting ${provider.label} ${node.group} ${node.index} part ${node.part}: ${answer} (from tree)`);
    try {
      const result = await submit(ctx, token, answer, contact);
      log(`Result: ${result.status} — ${result.message}`);
      await recordSubmitResult(this.extensionContext.workspaceState, provider, ctx, answer, result, token, contact);
      if (result.status === 'correct' || result.status === 'already-solved') {
        vscode.window.showInformationMessage(result.message);
      } else {
        vscode.window.showWarningMessage(result.message);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Puzzle Submitter: ${error instanceof Error ? error.message : String(error)}`);
    }
    this._onDidChangeTreeData.fire();
  }
}
