import * as path from 'node:path';
import * as vscode from 'vscode';
import { editorFileUri } from '../core/editorFile';
import { inputDocumentUri, refreshInputDocuments } from '../core/inputDocument';
import { FetchedExamples, PuzzleContext, PuzzleProvider } from '../types';
import { providers } from '../providers';
import { peekSite, promptAndSaveSite } from '../core/siteResolver';
import { getToken, requireToken, promptAndSaveToken, clearToken } from '../core/auth';
import { offerToClearStaleData } from '../core/accountSwitch';
import { getConfiguredRunCommand, runCommandForAnswer } from '../core/runCommand';
import { resolvePythonInterpreter, resolveSolverTimeoutSeconds } from '../core/pythonInterpreter';
import { canRunSolver, runPythonSolver, SolverError } from '../core/pythonRunner';
import { maxPartFor } from '../core/puzzleParts';
import { nextUnsolvedPart } from '../core/progress';
import { guardSubmit } from '../core/submitGuard';
import { checkWithoutSubmitting } from '../core/publishedAnswers';
import { recordSubmitResult, describeSubmitResult } from '../core/submitRecorder';
import { promptManualContext } from '../core/manualContext';
import { ensureLocalInput } from '../core/ensureInput';
import { inputFileSaver, readLocalInput, siteInputPath, writeLocalInput } from '../core/localInput';
import {
  ExampleRun,
  expectedAnswer,
  fetchAndCacheExamples,
  mergeExamples,
  needsExampleFetch,
  readExamples,
  runExamples,
  sameExamples,
  siteExamplesPath,
  writeExamples,
} from '../core/examples';
import { askForSolverInput, getOutputChannel, log, showFetchError, showSolverError } from '../core/output';
import { getWebviewHtml } from './panelHtml';
import { GridosPanel, GridosPanelState } from './gridosPanel';

/** Up to this size the panel shows the whole input, editable; past it, a read-only start. */
const INPUT_PREVIEW_LIMIT = 500_000;

type RunKind = { kind: 'solver' | 'examples'; withPrints: boolean };

interface PanelState {
  site?: { id: string; label: string };
  /** File name of the solution the panel is on — it stays on it while other files are open. */
  solutionFile?: string;
  context?: { group: string; index: string; part: number; maxPart: number };
  inputCached: boolean;
  /** The active part's cached text, editable unless truncated to INPUT_PREVIEW_LIMIT chars — only this
   * puzzle's input, never the rest of the site's consolidated store. */
  inputPreview?: { text: string; fullLength: number; truncated: boolean };
  hasToken: boolean;
  supportsSubmit: boolean;
  /** No submission API, but published answers to check against (Coding Quest): "Submit"
   * judges the answer locally instead of copying it to paste on the site. */
  checksLocally: boolean;
  supportsFetch: boolean;
  supportsSolver: boolean;
  /** How this site's solver() receives its input — the help card next to "Run" explains it. */
  solverShape?: 'text' | 'parts-dict';
  solverRunning: boolean;
  /** Only set when examples apply to the active file: a solver to run them with, and
   * either a site to fetch them from or some already in the cache. */
  examples?: { count: number; forPart: number; canFetch: boolean };
  examplesRunning: boolean;
  /** The last "Run on Examples" for exactly this file and part, if any. */
  exampleRuns?: ExampleRun[];
  hasRunCommand: boolean;
  lastResult?: { status: string; message: string };
  runOnSave: boolean;
  /** How the last save-triggered run went — shown in the panel, where a notification on
   * every save would be noise. */
  saveRunNote?: { ok: boolean; text: string };
  /** Set instead of the solver/answer sections for an Everybody Codes GridOS part. */
  gridos?: GridosPanelState;
}

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'setSite' }
  | { type: 'pickManually' }
  | { type: 'setPart'; part: number }
  | { type: 'openSite' }
  | { type: 'openSolution' }
  | { type: 'openFile'; path: string }
  | { type: 'gridosRun' }
  | { type: 'gridosSubmit'; path: string }
  | { type: 'fetchInput' }
  | { type: 'openInputInEditor' }
  | { type: 'saveInput'; text: string }
  | { type: 'runSolver'; withPrints?: boolean }
  | { type: 'setRunOnSave'; value: boolean }
  | { type: 'cancelSolver' }
  | { type: 'fetchExamples' }
  | { type: 'runExamples'; withPrints?: boolean }
  | { type: 'openExamples' }
  | { type: 'runCommand' }
  | { type: 'setToken' }
  | { type: 'clearToken' }
  | { type: 'submit'; answer: string };

/** Sidebar form for the current file's puzzle, so day-to-day use doesn't need the
 * command palette. All actual logic (network, files, Python) lives in ../core and
 * ../providers, exactly as it does for the palette commands in extension.ts — this
 * class only turns webview messages into calls on that same code and reports state back. */
export class PuzzleSubmitterViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private ctx: PuzzleContext | undefined;
  private provider: PuzzleProvider | undefined;
  /** Where the panel's puzzle came from. Kept when the active editor moves to anything
   * that isn't a puzzle file — another file, an output channel, no editor at all — so
   * the panel stays on the puzzle being worked on until another puzzle file is opened. */
  private folder: vscode.WorkspaceFolder | undefined;
  private solutionFile: string | undefined;
  private lastResult: { status: string; message: string } | undefined;
  private solverRunning = false;
  private examplesRunning = false;
  private exampleRuns: { key: string; runs: ExampleRun[] } | undefined;
  private solverKill: (() => void) | undefined;
  private solverCancelRequested = false;
  /** "Run on save": saving the solution repeats lastRun. Off whenever a window opens. */
  private runOnSave = false;
  private lastRun: RunKind | undefined;
  /** A save that came in mid-run: that run is being cancelled, this one starts after. */
  private rerunAfterCancel: RunKind | undefined;
  private saveRunNote: { ok: boolean; text: string } | undefined;

  private readonly gridos: GridosPanel;

  constructor(private readonly extensionContext: vscode.ExtensionContext) {
    this.gridos = new GridosPanel(extensionContext);
  }

  /** Called for every saved document (extension.ts). With "Run on save" on, saving the
   * panel's solution repeats the last run — or, before any, the examples when the puzzle
   * has some and the solver otherwise. A save during a run cancels it and starts over.
   * For GridOS, saving any .rules file of the part runs the part's files again. */
  onDidSave(document: vscode.TextDocument): void {
    if (this.runOnSave && this.ctx && GridosPanel.applies(this.provider, this.ctx)) {
      const partDir = this.gridos.partDir(this.solutionFile, this.ctx);
      if (partDir && document.uri.fsPath.endsWith('.rules') && path.dirname(document.uri.fsPath) === partDir) {
        void this.runGridos('save');
      }
      return;
    }
    if (!this.runOnSave || !this.solutionFile || document.uri.fsPath !== this.solutionFile) return;
    const run = this.lastRun ?? { kind: this.hasExamplesForPart() ? 'examples' : 'solver', withPrints: false };
    if (this.solverRunning || this.examplesRunning) {
      this.rerunAfterCancel = run;
      this.solverCancelRequested = true;
      this.solverKill?.();
      return;
    }
    void this.startRun(run, 'save');
  }

  private startRun(run: RunKind, trigger: 'click' | 'save'): Promise<void> {
    return run.kind === 'solver' ? this.runSolver(run.withPrints, trigger) : this.runExamples(run.withPrints, trigger);
  }

  private startPendingRerun(): void {
    const run = this.rerunAfterCancel;
    this.rerunAfterCancel = undefined;
    if (run) void this.startRun(run, 'save');
  }

  private hasExamplesForPart(): boolean {
    if (!this.provider || !this.ctx || !this.folder) return false;
    const part = this.ctx.part;
    return Boolean(readExamples(this.folder, this.provider.id, this.ctx)?.examples.some((e) => expectedAnswer(e, part) !== undefined));
  }

  private noteSaveRun(ok: boolean, text: string): void {
    this.saveRunNote = { ok, text: `Re-ran on save at ${new Date().toLocaleTimeString()} — ${text}` };
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getWebviewHtml();
    webviewView.webview.onDidReceiveMessage((msg) => void this.handleMessage(msg as WebviewMessage));
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) void this.refresh();
    });
    void this.refresh();
  }

  /** Follows the active editor when it's a puzzle file, and otherwise keeps showing the
   * puzzle it was on — called from extension.ts's onDidChangeActiveTextEditor (same
   * trigger as refreshStatusBar) and when the site setting changes. */
  async refresh(): Promise<void> {
    if (!this.view) return;
    const editor = vscode.window.activeTextEditor;
    const file = editor && editorFileUri(editor.document);
    const editorFolder = file && vscode.workspace.getWorkspaceFolder(file);
    const editorSite = editorFolder ? peekSite(editorFolder) : undefined;
    const detected = file && editorSite ? providers[editorSite].detect(vscode.workspace.asRelativePath(file, false)) : undefined;

    if (file && editorFolder && editorSite && detected) {
      const provider = providers[editorSite];
      const samePuzzle = provider === this.provider && this.ctx?.group === detected.group && this.ctx.index === detected.index;
      if (!samePuzzle) {
        detected.part = nextUnsolvedPart(this.extensionContext.workspaceState, provider, detected);
        this.ctx = detected;
        this.lastResult = undefined;
        this.saveRunNote = undefined;
      }
      // Another file of the same puzzle (its .rs twin, say) doesn't replace a Python
      // solution the panel can run.
      if (!samePuzzle || !this.solutionFile?.endsWith('.py') || file.fsPath.endsWith('.py')) this.solutionFile = file.fsPath;
      this.provider = provider;
      this.folder = editorFolder;
    } else {
      // Not a puzzle file: the panel stays as it is. Only the site is read again — "Set
      // Site" can change it — and the panel starts over if it did.
      this.folder = this.folder ?? editorFolder ?? vscode.workspace.workspaceFolders?.[0];
      const siteId = this.folder ? peekSite(this.folder) : undefined;
      const provider = siteId ? providers[siteId] : undefined;
      if (provider !== this.provider) {
        this.provider = provider;
        this.ctx = undefined;
        this.solutionFile = undefined;
        this.lastResult = undefined;
        this.saveRunNote = undefined;
      }
    }

    await this.postState();
  }

  private currentFolder(): vscode.WorkspaceFolder | undefined {
    return this.folder;
  }

  private async postState(): Promise<void> {
    if (!this.view) return;
    this.view.webview.postMessage({ type: 'state', state: await this.buildState() });
  }

  private async buildState(): Promise<PanelState> {
    const emptyState: PanelState = {
      inputCached: false,
      hasToken: false,
      supportsSubmit: false,
      checksLocally: false,
      supportsFetch: false,
      supportsSolver: false,
      solverRunning: false,
      examplesRunning: false,
      hasRunCommand: false,
      runOnSave: this.runOnSave,
    };
    const folder = this.currentFolder();
    if (!this.provider || !folder) return emptyState;

    const inputParts = this.ctx ? readLocalInput(folder, this.provider.id, this.ctx) : undefined;
    const currentPartText = this.ctx ? inputParts?.[String(this.ctx.part)] : undefined;
    const hasToken = this.provider.submit ? Boolean(await getToken(this.extensionContext.secrets, this.provider)) : false;
    const supportsSolver = this.solutionFile ? canRunSolver(this.provider, this.ctx, this.solutionFile) : false;
    const examples = supportsSolver && this.ctx ? this.examplesState(folder, this.ctx) : undefined;

    return {
      site: { id: this.provider.id, label: this.provider.label },
      solutionFile: this.ctx && this.solutionFile ? path.basename(this.solutionFile) : undefined,
      context: this.ctx
        ? { group: this.ctx.group, index: this.ctx.index, part: this.ctx.part, maxPart: maxPartFor(this.provider, this.ctx) }
        : undefined,
      inputCached: Boolean(currentPartText),
      inputPreview: currentPartText
        ? {
            text: currentPartText.slice(0, INPUT_PREVIEW_LIMIT),
            fullLength: currentPartText.length,
            truncated: currentPartText.length > INPUT_PREVIEW_LIMIT,
          }
        : undefined,
      hasToken,
      supportsSubmit: Boolean(this.provider.submit),
      checksLocally: !this.provider.submit && Boolean(this.provider.fetchPublishedAnswers),
      supportsFetch: Boolean(this.provider.fetchInput),
      supportsSolver,
      solverShape: this.provider.solverInputShape,
      solverRunning: this.solverRunning,
      examples,
      examplesRunning: this.examplesRunning,
      exampleRuns:
        this.solutionFile && this.ctx && this.exampleRuns?.key === this.exampleRunsKey(this.solutionFile, this.ctx)
          ? this.exampleRuns.runs
          : undefined,
      hasRunCommand: Boolean(getConfiguredRunCommand(folder)),
      lastResult: this.lastResult,
      runOnSave: this.runOnSave,
      saveRunNote: this.saveRunNote,
      ...(this.ctx && GridosPanel.applies(this.provider, this.ctx)
        ? { gridos: this.gridos.state(folder, this.provider, this.ctx, this.solutionFile) }
        : {}),
    };
  }

  private examplesState(folder: vscode.WorkspaceFolder, ctx: PuzzleContext): PanelState['examples'] {
    if (!this.provider) return undefined;
    const canFetch = Boolean(this.provider.fetchExamples);
    const examples = readExamples(folder, this.provider.id, ctx)?.examples ?? [];
    if (!canFetch && !examples.length) return undefined;
    return {
      count: examples.length,
      forPart: examples.filter((e) => expectedAnswer(e, ctx.part) !== undefined).length,
      canFetch,
    };
  }

  private exampleRunsKey(solutionFile: string, ctx: PuzzleContext): string {
    return `${solutionFile}|${ctx.part}`;
  }

  private async handleMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        return this.refresh();
      case 'setSite': {
        const site = await promptAndSaveSite(this.currentFolder());
        if (site) await this.refresh();
        return;
      }
      case 'pickManually': {
        if (!this.provider) return;
        const manual = await promptManualContext(this.provider);
        if (manual) {
          // The puzzle is picked for whichever file is open, which then becomes the
          // solution the panel runs — detection just couldn't place it.
          const active = vscode.window.activeTextEditor;
          const file = active && editorFileUri(active.document);
          const folder = file && vscode.workspace.getWorkspaceFolder(file);
          if (file && folder) {
            this.solutionFile = file.fsPath;
            this.folder = folder;
          }
          this.ctx = manual;
          await this.postState();
        }
        return;
      }
      case 'setPart':
        if (this.ctx) {
          this.ctx.part = msg.part;
          await this.postState();
        }
        return;
      case 'openSolution':
        if (this.solutionFile) await vscode.window.showTextDocument(vscode.Uri.file(this.solutionFile), { preview: false });
        return;
      case 'openFile':
        await vscode.window.showTextDocument(vscode.Uri.file(msg.path), { preview: false });
        return;
      case 'gridosRun':
        return this.runGridos('click');
      case 'gridosSubmit':
        return this.submitGridos(msg.path);
      case 'openSite':
        if (this.provider && this.ctx) {
          await vscode.env.openExternal(vscode.Uri.parse(this.provider.puzzleUrl(this.ctx)));
        }
        return;
      case 'fetchInput':
        return this.fetchInput();
      case 'openInputInEditor':
        return this.openInputInEditor();
      case 'saveInput':
        return this.saveInput(msg.text);
      case 'runSolver':
        return this.runSolver(msg.withPrints ?? false, 'click');
      case 'setRunOnSave':
        this.runOnSave = msg.value;
        if (!msg.value) this.saveRunNote = undefined;
        await this.postState();
        return;
      case 'cancelSolver':
        // Always flagged, not only before the process exists: "Run on Examples" spawns
        // one process per example, and a click landing between two of them would
        // otherwise only kill the one that had already finished.
        this.solverCancelRequested = true;
        this.solverKill?.();
        return;
      case 'fetchExamples':
        await this.fetchExamples();
        return;
      case 'runExamples':
        return this.runExamples(msg.withPrints ?? false, 'click');
      case 'openExamples':
        return this.openExamples();
      case 'runCommand':
        return this.runConfiguredCommand();
      case 'setToken':
        if (this.provider) {
          const token = await promptAndSaveToken(this.extensionContext.secrets, this.provider);
          const folder = this.currentFolder();
          if (token && folder) await offerToClearStaleData(folder, this.provider, this.extensionContext.workspaceState);
          await this.postState();
        }
        return;
      case 'clearToken':
        if (this.provider) {
          await clearToken(this.extensionContext.secrets, this.provider);
          await this.postState();
        }
        return;
      case 'submit':
        return this.submit(msg.answer);
    }
  }

  private async fetchInput(): Promise<void> {
    if (!this.provider?.fetchInput || !this.ctx) return;
    const folder = this.currentFolder();
    if (!folder) return;
    const token = await requireToken(this.extensionContext.secrets, this.provider);
    if (!token) return;
    const contact = vscode.workspace.getConfiguration('puzzleSubmitter').get<string>('contact', '');
    try {
      const parts = await this.provider.fetchInput(this.ctx, token, contact, inputFileSaver(folder, this.provider.id));
      writeLocalInput(folder, this.provider.id, this.ctx, parts);
      log(`Saved input to ${siteInputPath(this.provider.id)} (from panel)`);
      refreshInputDocuments();
    } catch (error) {
      showFetchError(error);
    }
    await this.postState();
  }

  /** Runs the GridOS part's .rules files (see GridosPanel). A save-triggered run reports
   * problems in the panel's run note rather than with a notification. */
  private async runGridos(trigger: 'click' | 'save'): Promise<void> {
    const folder = this.currentFolder();
    if (!folder || !this.provider || !this.ctx || this.gridos.running) return;
    if (trigger === 'click') this.saveRunNote = undefined;
    const problem = await this.gridos.run(folder, this.provider, this.ctx, this.solutionFile, trigger, () => this.postState());
    if (problem) {
      if (trigger === 'save') this.noteSaveRun(false, problem);
      else vscode.window.showWarningMessage(`Puzzle Submitter: ${problem}`);
    } else if (trigger === 'save') {
      this.noteSaveRun(true, 'rules files run again.');
    }
    await this.postState();
  }

  private async submitGridos(filePath: string): Promise<void> {
    const folder = this.currentFolder();
    if (!folder || !this.provider || !this.ctx) return;
    try {
      const result = await this.gridos.submit(folder, this.provider, this.ctx, filePath);
      if (result) this.lastResult = result;
    } catch (error) {
      this.lastResult = { status: 'unknown', message: error instanceof Error ? error.message : String(error) };
    }
    await this.postState();
  }

  /** Saves the panel's edited input for the active part. Other parts that held the very
   * same text (Advent of Code's single input, cached for both parts) get the edit too. */
  private async saveInput(text: string): Promise<void> {
    if (!this.provider || !this.ctx) return;
    const folder = this.currentFolder();
    if (!folder) return;
    const part = String(this.ctx.part);
    const cached = readLocalInput(folder, this.provider.id, this.ctx) ?? {};
    const updated = { [part]: text.replace(/\n$/, '') };
    for (const [other, otherText] of Object.entries(cached)) {
      if (other !== part && cached[part] !== undefined && otherText === cached[part]) updated[other] = updated[part];
    }
    writeLocalInput(folder, this.provider.id, this.ctx, updated);
    log(`Saved edited input to ${siteInputPath(this.provider.id)} (from panel)`);
    refreshInputDocuments();
    await this.postState();
  }

  /** Opens the active part's cached input in a read-only tab beside the solution, to read
   * it at full size — only this puzzle's input, never the site's whole JSON file. */
  private async openInputInEditor(): Promise<void> {
    if (!this.provider || !this.ctx) return;
    const folder = this.currentFolder();
    if (!folder) return;
    const doc = await vscode.workspace.openTextDocument(inputDocumentUri(folder, this.provider, this.ctx));
    await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
  }

  /** A save-triggered run ('save') never goes to the network — cached input only — and
   * reports in the panel (saveRunNote) instead of with notifications. */
  private async runSolver(withPrints: boolean, trigger: 'click' | 'save'): Promise<void> {
    if (!this.view || !this.provider?.solverInputShape || !this.ctx) return;
    const folder = this.currentFolder();
    const solutionFile = this.solutionFile;
    if (!folder || !solutionFile) return;
    this.lastRun = { kind: 'solver', withPrints };
    if (trigger === 'click') this.saveRunNote = undefined;

    const inputParts =
      trigger === 'save'
        ? readLocalInput(folder, this.provider.id, this.ctx)
        : await ensureLocalInput(this.provider, this.ctx, folder, this.extensionContext.secrets);
    if (!inputParts?.[String(this.ctx.part)]) {
      if (trigger === 'save') {
        this.noteSaveRun(false, 'no input cached for this part yet.');
      } else {
        const suggestion = this.provider.fetchInput ? 'the auto-fetch above didn\'t get this part' : 'paste it into the input box and Save';
        vscode.window.showErrorMessage(`Puzzle Submitter: no local input for this puzzle — ${suggestion}.`);
      }
      await this.postState();
      return;
    }
    this.solverRunning = true;
    this.solverCancelRequested = false;
    await this.postState(); // shows the Cancel button before the run actually starts
    try {
      const pythonPath = resolvePythonInterpreter(folder);
      const { parts, output } = await runPythonSolver(
        pythonPath,
        solutionFile,
        inputParts,
        this.provider.solverInputShape,
        this.ctx.part,
        folder.uri.fsPath,
        resolveSolverTimeoutSeconds(folder),
        (kill) => {
          // Cancel may have been requested in the brief window before the process
          // actually existed to kill — honor it now instead of losing the click.
          if (this.solverCancelRequested) kill();
          else this.solverKill = kill;
        },
        undefined,
        askForSolverInput // you just clicked or saved, so you're there to answer an input()
      );
      if (withPrints) {
        const channel = getOutputChannel();
        channel.appendLine(
          `--- solver() prints — ${this.provider.label} ${this.ctx.group ? this.ctx.group + ' ' : ''}${this.ctx.index} part ${this.ctx.part} ---`
        );
        channel.appendLine(output || '(nothing printed)');
        channel.show(true);
      }
      const answer = parts[this.ctx.part - 1] ?? parts[0] ?? '';
      this.view.webview.postMessage({ type: 'answerFilled', value: answer });
      if (trigger === 'save') this.noteSaveRun(true, `solver() gave ${answer}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/cancelled/i.test(message)) {
        if (!this.rerunAfterCancel) vscode.window.setStatusBarMessage('Puzzle Submitter: solver run cancelled.', 3000);
      } else if (trigger === 'save') {
        if (error instanceof SolverError && error.detail) log(error.detail);
        this.noteSaveRun(false, message);
      } else {
        showSolverError(error);
      }
    } finally {
      this.solverRunning = false;
      this.solverKill = undefined;
    }
    await this.postState(); // input may have just been auto-fetched — refresh the "cached" indicator
    this.startPendingRerun();
  }

  /** Opens the site's examples cache beside the solution, at this puzzle's entry, for
   * fixing an example by hand. preserveFocus keeps the solution as the active editor, so
   * the panel stays on it. */
  private async openExamples(): Promise<void> {
    const folder = this.currentFolder();
    if (!this.provider || !this.ctx || !folder) return;
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, siteExamplesPath(this.provider.id)));
    const text = doc.getText();
    const group = text.indexOf(`\n  ${JSON.stringify(this.ctx.group)}: {`);
    const entry = group === -1 ? -1 : text.indexOf(`\n    ${JSON.stringify(this.ctx.index)}: `, group);
    const at = doc.positionAt(entry === -1 ? 0 : entry + 1);
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: true,
      preview: false,
      selection: new vscode.Range(at, at),
    });
  }

  /** "Fetch Examples": reads the active puzzle's examples from the site again. If the
   * cache holds anything the site doesn't (examples fixed by hand), asks whether to keep
   * those and only add what's new, or replace them. */
  private async fetchExamples(): Promise<void> {
    if (!this.provider?.fetchExamples || !this.ctx) return;
    const folder = this.currentFolder();
    if (!folder) return;
    const provider = this.provider;
    const ctx = this.ctx;
    const token = await requireToken(this.extensionContext.secrets, provider);
    if (!token) return;
    const contact = vscode.workspace.getConfiguration('puzzleSubmitter').get<string>('contact', '');
    let fetched: FetchedExamples;
    try {
      fetched = await provider.fetchExamples!(ctx, token, contact);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Puzzle Submitter: couldn't fetch examples: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }

    const cached = readExamples(folder, provider.id, ctx);
    let entry = { parts: fetched.parts, examples: fetched.examples };
    const merged = mergeExamples(cached, fetched);
    if (cached?.examples.length && !sameExamples(merged.examples, fetched.examples)) {
      const choice = await vscode.window.showWarningMessage(
        `The cached examples for ${provider.itemNoun} ${ctx.index} differ from the site's — probably fixed by hand. Keep them and only add what's new, or replace them with the site's?`,
        { modal: true },
        'Keep Mine',
        'Replace'
      );
      if (!choice) return;
      if (choice === 'Keep Mine') entry = merged;
    }
    writeExamples(folder, provider.id, ctx, entry);
    log(`Saved ${entry.examples.length} example(s) for ${provider.itemNoun} ${ctx.index} to ${siteExamplesPath(provider.id)}`);
    if (!entry.examples.length) {
      vscode.window.showInformationMessage(`Puzzle Submitter: no examples found for ${provider.itemNoun} ${ctx.index}.`);
    }
    await this.postState();
  }

  private async runExamples(withPrints: boolean, trigger: 'click' | 'save'): Promise<void> {
    const provider = this.provider;
    const ctx = this.ctx;
    const shape = provider?.solverInputShape;
    const folder = this.currentFolder();
    const solutionFile = this.solutionFile;
    if (!provider || !ctx || !shape || !folder || !solutionFile) return;
    this.lastRun = { kind: 'examples', withPrints };
    if (trigger === 'click') this.saveRunNote = undefined;

    // Fetched only when the cache can't have this part yet — nothing cached, or cached
    // before this part's text was unlocked — and merged in, so hand fixes are kept. Never
    // on a save-triggered run, which mustn't send a request per save.
    let cached = readExamples(folder, provider.id, ctx);
    if (trigger === 'click' && provider.fetchExamples && needsExampleFetch(cached, ctx.part)) {
      const token = await requireToken(this.extensionContext.secrets, provider);
      if (!token) return;
      const contact = vscode.workspace.getConfiguration('puzzleSubmitter').get<string>('contact', '');
      try {
        cached = await fetchAndCacheExamples(provider, ctx, folder, token, contact);
      } catch (error) {
        vscode.window.showErrorMessage(
          `Puzzle Submitter: couldn't fetch examples: ${error instanceof Error ? error.message : String(error)}`
        );
        if (!cached) return;
      }
    }
    const examples = cached?.examples ?? [];
    if (!examples.some((e) => expectedAnswer(e, ctx.part) !== undefined)) {
      if (trigger === 'save') {
        this.noteSaveRun(false, `no cached example with a part ${ctx.part} answer.`);
        await this.postState();
        return;
      }
      const locked = provider.fetchExamples && cached && cached.parts < ctx.part;
      vscode.window.showInformationMessage(
        locked
          ? `Puzzle Submitter: part ${ctx.part}'s text isn't visible on the site yet — its examples appear once part ${ctx.part - 1} is solved.`
          : `Puzzle Submitter: no example with a part ${ctx.part} answer for ${provider.itemNoun} ${ctx.index}.`
      );
      await this.postState();
      return;
    }

    this.examplesRunning = true;
    this.solverCancelRequested = false;
    await this.postState();
    try {
      const runs = await runExamples(
        resolvePythonInterpreter(folder),
        solutionFile,
        shape,
        examples,
        ctx.part,
        folder.uri.fsPath,
        resolveSolverTimeoutSeconds(folder),
        (kill) => {
          if (this.solverCancelRequested) kill();
          else this.solverKill = kill;
        },
        askForSolverInput
      );
      this.exampleRuns = { key: this.exampleRunsKey(solutionFile, ctx), runs };
      const channel = getOutputChannel();
      for (const run of runs) {
        if (run.status === 'error' && run.detail) log(`Example ${run.index}: ${run.message}\n${run.detail}`);
        if (withPrints && run.status !== 'error') {
          channel.appendLine(`--- solver() prints — example ${run.index}, part ${ctx.part} ---`);
          channel.appendLine(run.output || '(nothing printed)');
        }
      }
      if (withPrints) channel.show(true);
      if (trigger === 'save') {
        const passed = runs.filter((run) => run.status === 'pass').length;
        this.noteSaveRun(passed === runs.length, `${passed}/${runs.length} examples passing.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/cancelled/i.test(message)) {
        if (!this.rerunAfterCancel) vscode.window.setStatusBarMessage('Puzzle Submitter: example run cancelled.', 3000);
      } else if (trigger === 'save') {
        this.noteSaveRun(false, message);
      } else {
        showSolverError(error);
      }
    } finally {
      this.examplesRunning = false;
      this.solverKill = undefined;
    }
    await this.postState();
    this.startPendingRerun();
  }

  private async runConfiguredCommand(): Promise<void> {
    if (!this.view || !this.ctx) return;
    const folder = this.currentFolder();
    const solutionFile = this.solutionFile;
    if (!folder || !solutionFile) return;
    const template = getConfiguredRunCommand(folder);
    if (!template) return;
    try {
      const output = await runCommandForAnswer(template, this.ctx, solutionFile, folder.uri.fsPath);
      this.view.webview.postMessage({ type: 'answerFilled', value: output });
    } catch (error) {
      vscode.window.showErrorMessage(`Puzzle Submitter: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async submit(answer: string): Promise<void> {
    if (!this.provider || !this.ctx || !answer.trim()) return;

    if (!this.provider.submit) {
      const contact = vscode.workspace.getConfiguration('puzzleSubmitter').get<string>('contact', '');
      const check = await checkWithoutSubmitting(this.extensionContext.workspaceState, this.provider, this.ctx, answer, contact);
      if (check === 'match') {
        this.lastResult = { status: 'correct', message: `✅ "${answer}" is the right answer.` };
      } else if (check === 'mismatch') {
        this.lastResult = { status: 'incorrect', message: `❌ "${answer}" is not the right answer.` };
      } else {
        // Nothing to judge it by: hand it over for the site instead.
        await vscode.env.clipboard.writeText(answer);
        await vscode.env.openExternal(vscode.Uri.parse(this.provider.puzzleUrl(this.ctx)));
        this.lastResult = {
          status: 'copied',
          message: `No published answer to check against — answer copied, puzzle page opened.`,
        };
      }
      await this.postState();
      return;
    }

    const guard = await guardSubmit(this.extensionContext.workspaceState, this.provider, this.ctx, answer);
    if (guard === 'cancelled') return;
    if (guard === 'skip') {
      this.lastResult = { status: 'already-solved', message: `"${answer}" already matches the recorded answer — not submitting again.` };
      await this.postState();
      return;
    }

    const token = await requireToken(this.extensionContext.secrets, this.provider);
    if (!token) return;
    const contact = vscode.workspace.getConfiguration('puzzleSubmitter').get<string>('contact', '');

    log(
      `Submitting ${this.provider.label} ${this.ctx.group ? this.ctx.group + ' ' : ''}${this.ctx.index} part ${this.ctx.part}: ${answer} (from panel)`
    );
    try {
      const result = await this.provider.submit(this.ctx, token, answer, contact);
      log(`Result: ${result.status} — ${result.message}`);
      const recorded = await recordSubmitResult(this.extensionContext.workspaceState, this.provider, this.ctx, answer, result, token, contact);
      this.lastResult = { status: result.status, message: describeSubmitResult(result, answer, recorded) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Error: ${message}`);
      this.lastResult = { status: 'unknown', message };
    }
    await this.postState();
  }
}
