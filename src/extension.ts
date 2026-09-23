import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { PuzzleContext, PuzzleProvider } from './types';
import { providers } from './providers';
import { resolveSite, promptAndSaveSite } from './core/siteResolver';
import { requireToken, promptAndSaveToken, clearToken } from './core/auth';
import { getConfiguredRunCommand, runCommandForAnswer } from './core/runCommand';
import { markSolved, nextUnsolvedPart } from './core/progress';
import { getStatusBarItem, refreshStatusBar } from './core/statusBar';
import { getOutputChannel, log } from './core/output';

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

async function promptManualContext(provider: PuzzleProvider): Promise<PuzzleContext | undefined> {
  const index = await vscode.window.showInputBox({
    title: `${provider.label}: puzzle/day/quest number`,
    ignoreFocusOut: true,
  });
  if (!index) return undefined;

  const group = await vscode.window.showInputBox({
    title: `${provider.label}: year/event/story (leave empty if this site doesn't group by one)`,
    ignoreFocusOut: true,
  });
  if (group === undefined) return undefined;

  const part = await vscode.window.showQuickPick(
    Array.from({ length: provider.maxPart }, (_, i) => String(i + 1)),
    { title: 'Which part?' }
  );
  if (!part) return undefined;

  return { group: group.trim(), index: index.trim(), part: Number(part) };
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

async function resolveAnswer(
  provider: PuzzleProvider,
  ctx: PuzzleContext,
  editor: vscode.TextEditor,
  folder: vscode.WorkspaceFolder
): Promise<string | undefined> {
  const label = `Answer — ${provider.label}${ctx.group ? ' ' + ctx.group : ''} ${ctx.index} part ${ctx.part}`;
  const template = getConfiguredRunCommand(folder);
  if (!template) {
    return vscode.window.showInputBox({ title: label, ignoreFocusOut: true });
  }

  const choice = await vscode.window.showQuickPick(
    [
      { label: '$(play) Run configured command', detail: template, id: 'run' as const },
      { label: '$(edit) Type the answer', id: 'manual' as const },
    ],
    { title: 'How do you want to provide the answer?' }
  );
  if (!choice) return undefined;
  if (choice.id === 'manual') {
    return vscode.window.showInputBox({ title: label, ignoreFocusOut: true });
  }

  try {
    const output = await runCommandForAnswer(template, ctx, editor.document.uri.fsPath, folder.uri.fsPath);
    return vscode.window.showInputBox({ title: `${label} (from command output — edit if needed)`, value: output, ignoreFocusOut: true });
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

  const answer = await resolveAnswer(provider, ctx, editor, folder);
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
          await markSolved(context.workspaceState, provider, ctx, ctx.part);
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
}

async function fetchInputCommand(context: vscode.ExtensionContext): Promise<void> {
  const target = requireWorkspaceEditor();
  if (!target) return;
  const { editor, folder } = target;

  const siteId = await resolveSite(folder);
  if (!siteId) return;
  const provider = providers[siteId];

  if (!provider.fetchInput || !provider.inputPath) {
    vscode.window.showInformationMessage(`${provider.label} has no known input-fetching API.`);
    return;
  }

  const ctx = await resolveContext(provider, editor, context.workspaceState);
  if (!ctx) return;

  const targetPath = path.join(folder.uri.fsPath, provider.inputPath(ctx));
  if (fs.existsSync(targetPath)) {
    vscode.window.showInformationMessage(`Input already cached at ${vscode.workspace.asRelativePath(targetPath)} — not re-downloading.`);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(targetPath));
    return;
  }

  const token = await requireToken(context.secrets, provider);
  if (!token) return;
  const contact = vscode.workspace.getConfiguration('puzzleSubmitter').get<string>('contact', '');

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Fetching input from ${provider.label}…` },
    async () => {
      try {
        const input = await provider.fetchInput!(ctx, token, contact);
        await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.promises.writeFile(targetPath, input, 'utf8');
        log(`Saved input to ${targetPath}`);
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(targetPath));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Error: ${message}`);
        vscode.window.showErrorMessage(`Puzzle Submitter: ${message}`);
      }
    }
  );
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
  }
}

async function clearTokenCommand(context: vscode.ExtensionContext): Promise<void> {
  const siteId = await resolveSite(activeOrFirstFolder());
  if (!siteId) return;
  const provider = providers[siteId];
  await clearToken(context.secrets, provider);
  vscode.window.showInformationMessage(`Puzzle Submitter: token cleared for ${provider.label}.`);
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('puzzleSubmitter.submitAnswer', () => submitAnswerCommand(context)),
    vscode.commands.registerCommand('puzzleSubmitter.fetchInput', () => fetchInputCommand(context)),
    vscode.commands.registerCommand('puzzleSubmitter.setToken', () => setTokenCommand(context)),
    vscode.commands.registerCommand('puzzleSubmitter.clearToken', () => clearTokenCommand(context)),
    vscode.commands.registerCommand('puzzleSubmitter.setSite', async () => {
      const site = await promptAndSaveSite(activeOrFirstFolder());
      if (site) refreshStatusBar(vscode.window.activeTextEditor);
    }),
    getOutputChannel(),
    getStatusBarItem(),
    vscode.window.onDidChangeActiveTextEditor(refreshStatusBar),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('puzzleSubmitter.site')) {
        refreshStatusBar(vscode.window.activeTextEditor);
      }
    })
  );

  refreshStatusBar(vscode.window.activeTextEditor);
}

export function deactivate(): void {
  // Nothing to clean up explicitly — everything is registered via context.subscriptions.
}
