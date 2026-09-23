import * as vscode from 'vscode';
import { PuzzleContext, PuzzleProvider } from './types';
import { providers } from './providers';
import { resolveSite, promptAndSaveSite } from './core/siteResolver';
import { promptManualContext } from './core/manualContext';
import { PuzzleSubmitterViewProvider } from './webview/panelProvider';
import { PuzzleTreeProvider, TreeNode } from './tree/puzzleTreeProvider';
import { requireToken, promptAndSaveToken, clearToken } from './core/auth';
import { getConfiguredRunCommand, runCommandForAnswer } from './core/runCommand';
import { resolvePythonInterpreter } from './core/pythonInterpreter';
import { canRunSolver, runPythonSolver } from './core/pythonRunner';
import { ensureLocalInput } from './core/ensureInput';
import { readLocalInput, siteInputPath, writeLocalInput } from './core/localInput';
import { markSolved, nextUnsolvedPart } from './core/progress';
import { getStatusBarItem, refreshStatusBar } from './core/statusBar';
import { getOutputChannel, log } from './core/output';

let panelProvider: PuzzleSubmitterViewProvider | undefined;
let treeProvider: PuzzleTreeProvider | undefined;

function requireWorkspaceEditor(): { editor: vscode.TextEditor; folder: vscode.WorkspaceFolder } | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('Puzzle Submitter: open a solution file first.');
    return undefined;
  }
  const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (!folder) {
    vscode.window.showErrorMessage('Puzzle Submitter: the active file must be inside an open workspace folder.');
    return undefined;
  }
  return { editor, folder };
}

/** Best-effort workspace folder for commands invoked without a relevant active editor (token management). */
function activeOrFirstFolder(): vscode.WorkspaceFolder | undefined {
  const active = vscode.window.activeTextEditor;
  return (active && vscode.workspace.getWorkspaceFolder(active.document.uri)) ?? vscode.workspace.workspaceFolders?.[0];
}

/** Lets the user accept (Enter) or override the guessed part — only asked when there's
 * more than one possible part, so single-part sites never see an extra prompt. */
async function confirmPart(provider: PuzzleProvider, guessed: number): Promise<number | undefined> {
  if (provider.maxPart <= 1) {
    return guessed;
  }
  const options = Array.from({ length: provider.maxPart }, (_, i) => i + 1)
    .sort((a, b) => (a === guessed ? -1 : b === guessed ? 1 : a - b))
    .map((part) => ({ label: `Part ${part}${part === guessed ? ' (guessed — press Enter to keep)' : ''}`, part }));
  const picked = await vscode.window.showQuickPick(options, { title: `${provider.label}: which part?` });
  return picked?.part;
}

async function resolveContext(
  provider: PuzzleProvider,
  editor: vscode.TextEditor,
  workspaceState: vscode.Memento
): Promise<PuzzleContext | undefined> {
  const relativePath = vscode.workspace.asRelativePath(editor.document.uri, false);
  const detected = provider.detect(relativePath);
  if (detected) {
    // detect() always returns part 1 as a structural placeholder. Guess the first part
    // this extension hasn't seen marked solved yet (it has no visibility into puzzles
    // solved outside of it), then let the user confirm or override that guess.
    const guessed = nextUnsolvedPart(workspaceState, provider, detected);
    const confirmed = await confirmPart(provider, guessed);
    if (!confirmed) return undefined;
    detected.part = confirmed;
    return detected;
  }
  vscode.window.showWarningMessage(`Puzzle Submitter: couldn't detect a ${provider.label} puzzle from this file — enter it manually.`);
  return promptManualContext(provider);
}

async function runSolverForAnswer(
  provider: PuzzleProvider,
  ctx: PuzzleContext,
  editor: vscode.TextEditor,
  folder: vscode.WorkspaceFolder,
  secrets: vscode.SecretStorage
): Promise<string | undefined> {
  if (!provider.solverInputShape) return undefined; // guarded by the caller, but keeps TS happy
  const inputParts = await ensureLocalInput(provider, ctx, folder, secrets);
  if (!inputParts?.[String(ctx.part)]) {
    const suggestion = provider.fetchInput ? "auto-fetch didn't get this part" : 'run "Set Input" first';
    vscode.window.showErrorMessage(
      `Puzzle Submitter: no local input for this puzzle in ${siteInputPath(provider.id)} — ${suggestion}.`
    );
    return undefined;
  }
  const pythonPath = resolvePythonInterpreter(folder);
  const { parts } = await runPythonSolver(
    pythonPath,
    editor.document.uri.fsPath,
    inputParts,
    provider.solverInputShape,
    ctx.part,
    folder.uri.fsPath
  );
  return parts[ctx.part - 1] ?? parts[0];
}

async function resolveAnswer(
  provider: PuzzleProvider,
  ctx: PuzzleContext,
  editor: vscode.TextEditor,
  folder: vscode.WorkspaceFolder,
  secrets: vscode.SecretStorage
): Promise<string | undefined> {
  const label = `Answer — ${provider.label}${ctx.group ? ' ' + ctx.group : ''} ${ctx.index} part ${ctx.part}`;
  const template = getConfiguredRunCommand(folder);
  const solverEligible = canRunSolver(provider, ctx, editor.document.uri.fsPath);

  if (!template && !solverEligible) {
    return vscode.window.showInputBox({ title: label, ignoreFocusOut: true });
  }

  const choice = await vscode.window.showQuickPick(
    [
      ...(solverEligible ? [{ label: '$(play) Run solver() from this file', id: 'solver' as const }] : []),
      ...(template ? [{ label: '$(terminal) Run configured command', detail: template, id: 'run' as const }] : []),
      { label: '$(edit) Type the answer', id: 'manual' as const },
    ],
    { title: 'How do you want to provide the answer?' }
  );
  if (!choice) return undefined;
  if (choice.id === 'manual') {
    return vscode.window.showInputBox({ title: label, ignoreFocusOut: true });
  }

  try {
    const output =
      choice.id === 'solver'
        ? await runSolverForAnswer(provider, ctx, editor, folder, secrets)
        : await runCommandForAnswer(template, ctx, editor.document.uri.fsPath, folder.uri.fsPath);
    if (output === undefined) return undefined;
    return vscode.window.showInputBox({ title: `${label} (from ${choice.id === 'solver' ? 'solver()' : 'command output'} — edit if needed)`, value: output, ignoreFocusOut: true });
  } catch (error) {
    vscode.window.showErrorMessage(`Puzzle Submitter: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function submitAnswerCommand(context: vscode.ExtensionContext): Promise<void> {
  const target = requireWorkspaceEditor();
  if (!target) return;
  const { editor, folder } = target;

  const siteId = await resolveSite(folder);
  if (!siteId) return;
  const provider = providers[siteId];

  const ctx = await resolveContext(provider, editor, context.workspaceState);
  if (!ctx) return;

  const answer = await resolveAnswer(provider, ctx, editor, folder, context.secrets);
  if (!answer) return;

  if (!provider.submit) {
    await vscode.env.clipboard.writeText(answer);
    await vscode.env.openExternal(vscode.Uri.parse(provider.puzzleUrl(ctx)));
    vscode.window.showInformationMessage(
      `${provider.label} has no submission API — answer "${answer}" copied to the clipboard, puzzle page opened.`
    );
    return;
  }

  const token = await requireToken(context.secrets, provider);
  if (!token) return;
  const contact = vscode.workspace.getConfiguration('puzzleSubmitter').get<string>('contact', '');

  log(`Submitting ${provider.label} ${ctx.group ? ctx.group + ' ' : ''}${ctx.index} part ${ctx.part}: ${answer}`);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Submitting to ${provider.label}…` },
    async () => {
      try {
        const result = await provider.submit!(ctx, token, answer, contact);
        log(`Result: ${result.status} — ${result.message}`);

        if (result.status === 'correct' || result.status === 'already-solved') {
          await markSolved(context.workspaceState, provider, ctx, ctx.part, result.status === 'correct' ? answer : undefined);
        }

        const icon = { correct: '✅', 'already-solved': 'ℹ️', incorrect: '❌', 'rate-limited': '⏳', unknown: '⚠️' }[
          result.status
        ];
        if (result.status === 'correct' || result.status === 'already-solved') {
          vscode.window.showInformationMessage(`${icon} ${result.message}`);
        } else {
          vscode.window.showWarningMessage(`${icon} ${result.message}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Error: ${message}`);
        vscode.window.showErrorMessage(`Puzzle Submitter: ${message}`);
      }
    }
  );

  refreshStatusBar(editor);
  void panelProvider?.refresh();
  void treeProvider?.refresh();
}

async function fetchInputCommand(context: vscode.ExtensionContext): Promise<void> {
  const target = requireWorkspaceEditor();
  if (!target) return;
  const { editor, folder } = target;

  const siteId = await resolveSite(folder);
  if (!siteId) return;
  const provider = providers[siteId];

  if (!provider.fetchInput) {
    vscode.window.showInformationMessage(`${provider.label} has no known input-fetching API — use "Set Input" instead.`);
    return;
  }

  const ctx = await resolveContext(provider, editor, context.workspaceState);
  if (!ctx) return;

  const existing = readLocalInput(folder, provider.id, ctx);
  if (existing?.[String(ctx.part)]) {
    vscode.window.showInformationMessage(`Input already cached in ${siteInputPath(provider.id)} — not re-downloading.`);
    return;
  }

  const token = await requireToken(context.secrets, provider);
  if (!token) return;
  const contact = vscode.workspace.getConfiguration('puzzleSubmitter').get<string>('contact', '');

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Fetching input from ${provider.label}…` },
    async () => {
      try {
        const parts = await provider.fetchInput!(ctx, token, contact);
        writeLocalInput(folder, provider.id, ctx, parts);
        log(`Saved input to ${siteInputPath(provider.id)}`);
        vscode.window.showInformationMessage(`Puzzle Submitter: input saved to ${siteInputPath(provider.id)}.`);
        void panelProvider?.refresh();
        void treeProvider?.refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Error: ${message}`);
        vscode.window.showErrorMessage(`Puzzle Submitter: ${message}`);
      }
    }
  );
}

async function setInputCommand(context: vscode.ExtensionContext): Promise<void> {
  const target = requireWorkspaceEditor();
  if (!target) return;
  const { editor, folder } = target;

  const siteId = await resolveSite(folder);
  if (!siteId) return;
  const provider = providers[siteId];

  const ctx = await resolveContext(provider, editor, context.workspaceState);
  if (!ctx) return;

  const clipboard = await vscode.env.clipboard.readText();
  if (!clipboard.trim()) {
    vscode.window.showErrorMessage('Puzzle Submitter: clipboard is empty — copy the puzzle input first.');
    return;
  }

  const confirmed = await vscode.window.showInformationMessage(
    `Save ${clipboard.length} characters from the clipboard as the input for ${provider.label}${ctx.group ? ' ' + ctx.group : ''} ${ctx.index} part ${ctx.part}?`,
    { modal: true },
    'Save'
  );
  if (confirmed !== 'Save') return;

  writeLocalInput(folder, provider.id, ctx, { [String(ctx.part)]: clipboard.replace(/\n$/, '') });
  log(`Saved input to ${siteInputPath(provider.id)} (from clipboard)`);
  vscode.window.showInformationMessage(`Puzzle Submitter: input saved to ${siteInputPath(provider.id)}.`);
  void panelProvider?.refresh();
  void treeProvider?.refresh();
}

async function setTokenCommand(context: vscode.ExtensionContext): Promise<void> {
  const siteId = await resolveSite(activeOrFirstFolder());
  if (!siteId) return;
  const provider = providers[siteId];
  if (!provider.submit) {
    vscode.window.showInformationMessage(`${provider.label} has no submission API, so no token is needed.`);
    return;
  }
  const token = await promptAndSaveToken(context.secrets, provider);
  if (token) {
    vscode.window.showInformationMessage(`Puzzle Submitter: token saved for ${provider.label}.`);
    void panelProvider?.refresh();
    void treeProvider?.refresh();
  }
}

async function clearTokenCommand(context: vscode.ExtensionContext): Promise<void> {
  const siteId = await resolveSite(activeOrFirstFolder());
  if (!siteId) return;
  const provider = providers[siteId];
  await clearToken(context.secrets, provider);
  void panelProvider?.refresh();
  void treeProvider?.refresh();
  vscode.window.showInformationMessage(`Puzzle Submitter: token cleared for ${provider.label}.`);
}

export function activate(context: vscode.ExtensionContext): void {
  const view = new PuzzleSubmitterViewProvider(context);
  panelProvider = view;
  const tree = new PuzzleTreeProvider(context);
  treeProvider = tree;

  const refreshAll = (editor?: vscode.TextEditor) => {
    refreshStatusBar(editor ?? vscode.window.activeTextEditor);
    void view.refresh();
    void tree.refresh();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('puzzleSubmitter.submitAnswer', () => submitAnswerCommand(context)),
    vscode.commands.registerCommand('puzzleSubmitter.fetchInput', () => fetchInputCommand(context)),
    vscode.commands.registerCommand('puzzleSubmitter.setInput', () => setInputCommand(context)),
    vscode.commands.registerCommand('puzzleSubmitter.setToken', () => setTokenCommand(context)),
    vscode.commands.registerCommand('puzzleSubmitter.clearToken', () => clearTokenCommand(context)),
    vscode.commands.registerCommand('puzzleSubmitter.setSite', async () => {
      const site = await promptAndSaveSite(activeOrFirstFolder());
      if (site) refreshAll();
    }),
    vscode.commands.registerCommand('puzzleSubmitter.tree.refresh', () => tree.refresh()),
    vscode.commands.registerCommand('puzzleSubmitter.tree.benchmarkQuest', (node: TreeNode) => {
      if (node?.kind === 'quest') return tree.benchmarkQuest(node);
      return undefined;
    }),
    vscode.commands.registerCommand('puzzleSubmitter.tree.benchmarkEvent', (node: TreeNode) => {
      if (node?.kind === 'event') return tree.benchmarkEvent(node);
      return undefined;
    }),
    vscode.commands.registerCommand('puzzleSubmitter.tree.submitPart', (node: TreeNode) => {
      if (node?.kind === 'part') return tree.submitPart(node);
      return undefined;
    }),
    vscode.window.registerWebviewViewProvider('puzzleSubmitter.panel', view),
    vscode.window.registerTreeDataProvider('puzzleSubmitter.tree', tree),
    getOutputChannel(),
    getStatusBarItem(),
    vscode.window.onDidChangeActiveTextEditor((editor) => refreshAll(editor)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('puzzleSubmitter.site')) refreshAll();
    })
  );

  refreshAll();
}

export function deactivate(): void {
  // Nothing to clean up explicitly — everything is registered via context.subscriptions.
}
