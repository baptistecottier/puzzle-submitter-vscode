import * as vscode from 'vscode';
import { PuzzleContext, PuzzleProvider } from '../types';
import { providers } from '../providers';
import { peekSite, promptAndSaveSite } from '../core/siteResolver';
import { getToken, requireToken, promptAndSaveToken, clearToken } from '../core/auth';
import { getConfiguredRunCommand, runCommandForAnswer } from '../core/runCommand';
import { resolvePythonInterpreter } from '../core/pythonInterpreter';
import { canRunSolver, runPythonSolver } from '../core/pythonRunner';
import { markSolved, nextUnsolvedPart, listSolvedPuzzles, SolvedPuzzle } from '../core/progress';
import { promptManualContext } from '../core/manualContext';
import { ensureLocalInput } from '../core/ensureInput';
import { readLocalInput, siteInputPath, writeLocalInput } from '../core/localInput';
import { log } from '../core/output';
import { getWebviewHtml } from './panelHtml';

const INPUT_PREVIEW_LIMIT = 2000;

interface PanelState {
  site?: { id: string; label: string };
  context?: { group: string; index: string; part: number; maxPart: number };
  inputCached: boolean;
  /** The active part's cached text, truncated to INPUT_PREVIEW_LIMIT chars — only this
   * puzzle's input, never the rest of the site's consolidated store. */
  inputPreview?: { text: string; fullLength: number; truncated: boolean };
  hasToken: boolean;
  supportsSubmit: boolean;
  supportsFetch: boolean;
  supportsSolver: boolean;
  hasRunCommand: boolean;
  progress: SolvedPuzzle[];
  lastResult?: { status: string; message: string };
}

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'setSite' }
  | { type: 'pickManually' }
  | { type: 'setPart'; part: number }
  | { type: 'openSite' }
  | { type: 'fetchInput' }
  | { type: 'setInputFromClipboard' }
  | { type: 'openInputInEditor' }
  | { type: 'runSolver' }
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
  private lastResult: { status: string; message: string } | undefined;

  constructor(private readonly extensionContext: vscode.ExtensionContext) {}

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

  /** Re-detects the puzzle from the active editor and pushes fresh state — called from
   * extension.ts's onDidChangeActiveTextEditor, same trigger as refreshStatusBar. */
  async refresh(): Promise<void> {
    if (!this.view) return;
    const editor = vscode.window.activeTextEditor;
    const folder = editor && vscode.workspace.getWorkspaceFolder(editor.document.uri);
    const siteId = folder ? peekSite(folder) : undefined;
    this.provider = siteId ? providers[siteId] : undefined;

    if (this.provider && editor && folder) {
      const relativePath = vscode.workspace.asRelativePath(editor.document.uri, false);
      const detected = this.provider.detect(relativePath);
      if (detected) {
        if (!this.ctx || this.ctx.group !== detected.group || this.ctx.index !== detected.index) {
          detected.part = nextUnsolvedPart(this.extensionContext.workspaceState, this.provider, detected);
          this.ctx = detected;
        }
      } else {
        this.ctx = undefined;
      }
    } else {
      this.ctx = undefined;
    }

    await this.postState();
  }

  private currentFolder(): vscode.WorkspaceFolder | undefined {
    const editor = vscode.window.activeTextEditor;
    return editor && vscode.workspace.getWorkspaceFolder(editor.document.uri);
  }

  private async postState(): Promise<void> {
    if (!this.view) return;
    this.view.webview.postMessage({ type: 'state', state: await this.buildState() });
  }

  private async buildState(): Promise<PanelState> {
    const emptyState: PanelState = {
      progress: [],
      inputCached: false,
      hasToken: false,
      supportsSubmit: false,
      supportsFetch: false,
      supportsSolver: false,
      hasRunCommand: false,
    };
    const editor = vscode.window.activeTextEditor;
    const folder = this.currentFolder();
    if (!this.provider || !folder) return emptyState;

    const inputParts = this.ctx ? readLocalInput(folder, this.provider.id, this.ctx) : undefined;
    const currentPartText = this.ctx ? inputParts?.[String(this.ctx.part)] : undefined;
    const hasToken = this.provider.submit ? Boolean(await getToken(this.extensionContext.secrets, this.provider)) : false;
    const supportsSolver = editor ? canRunSolver(this.provider, this.ctx, editor.document.uri.fsPath) : false;

    return {
      site: { id: this.provider.id, label: this.provider.label },
      context: this.ctx
        ? { group: this.ctx.group, index: this.ctx.index, part: this.ctx.part, maxPart: this.provider.maxPart }
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
      supportsFetch: Boolean(this.provider.fetchInput),
      supportsSolver,
      hasRunCommand: Boolean(getConfiguredRunCommand(folder)),
      progress: listSolvedPuzzles(this.extensionContext.workspaceState, this.provider),
      lastResult: this.lastResult,
    };
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
      case 'openSite':
        if (this.provider && this.ctx) {
          await vscode.env.openExternal(vscode.Uri.parse(this.provider.puzzleUrl(this.ctx)));
        }
        return;
      case 'fetchInput':
        return this.fetchInput();
      case 'setInputFromClipboard':
        return this.setInputFromClipboard();
      case 'openInputInEditor':
        return this.openInputInEditor();
      case 'runSolver':
        return this.runSolver();
      case 'runCommand':
        return this.runConfiguredCommand();
      case 'setToken':
        if (this.provider) {
          await promptAndSaveToken(this.extensionContext.secrets, this.provider);
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
      const parts = await this.provider.fetchInput(this.ctx, token, contact);
      writeLocalInput(folder, this.provider.id, this.ctx, parts);
      log(`Saved input to ${siteInputPath(this.provider.id)} (from panel)`);
    } catch (error) {
      vscode.window.showErrorMessage(`Puzzle Submitter: ${error instanceof Error ? error.message : String(error)}`);
    }
    await this.postState();
  }

  private async setInputFromClipboard(): Promise<void> {
    if (!this.provider || !this.ctx) return;
    const folder = this.currentFolder();
    if (!folder) return;
    const clipboard = await vscode.env.clipboard.readText();
    if (!clipboard.trim()) {
      vscode.window.showErrorMessage('Puzzle Submitter: clipboard is empty — copy the puzzle input first.');
      return;
    }
    writeLocalInput(folder, this.provider.id, this.ctx, { [String(this.ctx.part)]: clipboard.replace(/\n$/, '') });
    await this.postState();
  }

  /** Opens the active puzzle's full (untruncated) cached input as an untitled tab — for
   * inputs too big for the panel's inline preview. Never touches the site's JSON file on
   * disk, just shows its content for this one puzzle. */
  private async openInputInEditor(): Promise<void> {
    if (!this.provider || !this.ctx) return;
    const folder = this.currentFolder();
    if (!folder) return;
    const text = readLocalInput(folder, this.provider.id, this.ctx)?.[String(this.ctx.part)];
    if (!text) return;
    const doc = await vscode.workspace.openTextDocument({ content: text, language: 'plaintext' });
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  private async runSolver(): Promise<void> {
    if (!this.view || !this.provider?.solverInputShape || !this.ctx) return;
    const editor = vscode.window.activeTextEditor;
    const folder = this.currentFolder();
    if (!editor || !folder) return;

    const inputParts = await ensureLocalInput(this.provider, this.ctx, folder, this.extensionContext.secrets);
    if (!inputParts?.[String(this.ctx.part)]) {
      const suggestion = this.provider.fetchInput ? 'the auto-fetch above didn\'t get this part' : 'use "Set from Clipboard"';
      vscode.window.showErrorMessage(`Puzzle Submitter: no local input for this puzzle — ${suggestion}.`);
      await this.postState();
      return;
    }
    try {
      const pythonPath = resolvePythonInterpreter(folder);
      const { parts } = await runPythonSolver(
        pythonPath,
        editor.document.uri.fsPath,
        inputParts,
        this.provider.solverInputShape,
        this.ctx.part,
        folder.uri.fsPath
      );
      this.view.webview.postMessage({ type: 'answerFilled', value: parts[this.ctx.part - 1] ?? parts[0] ?? '' });
    } catch (error) {
      vscode.window.showErrorMessage(`Puzzle Submitter: ${error instanceof Error ? error.message : String(error)}`);
    }
    await this.postState(); // input may have just been auto-fetched — refresh the "cached" indicator
  }

  private async runConfiguredCommand(): Promise<void> {
    if (!this.view || !this.ctx) return;
    const editor = vscode.window.activeTextEditor;
    const folder = this.currentFolder();
    if (!editor || !folder) return;
    const template = getConfiguredRunCommand(folder);
    if (!template) return;
    try {
      const output = await runCommandForAnswer(template, this.ctx, editor.document.uri.fsPath, folder.uri.fsPath);
      this.view.webview.postMessage({ type: 'answerFilled', value: output });
    } catch (error) {
      vscode.window.showErrorMessage(`Puzzle Submitter: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async submit(answer: string): Promise<void> {
    if (!this.provider || !this.ctx || !answer.trim()) return;

    if (!this.provider.submit) {
      await vscode.env.clipboard.writeText(answer);
      await vscode.env.openExternal(vscode.Uri.parse(this.provider.puzzleUrl(this.ctx)));
      this.lastResult = {
        status: 'copied',
        message: `${this.provider.label} has no submission API — answer copied, puzzle page opened.`,
      };
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
      this.lastResult = result;
      if (result.status === 'correct' || result.status === 'already-solved') {
        await markSolved(
          this.extensionContext.workspaceState,
          this.provider,
          this.ctx,
          this.ctx.part,
          result.status === 'correct' ? answer : undefined
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Error: ${message}`);
      this.lastResult = { status: 'unknown', message };
    }
    await this.postState();
  }
}
