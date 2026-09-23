import * as vscode from 'vscode';
import { SiteId } from '../types';
import { allProviders, providers } from '../providers';

const CONFIG_SECTION = 'puzzleSubmitter';

function isSiteId(value: unknown): value is SiteId {
  return typeof value === 'string' && value in providers;
}

/** Reads puzzleSubmitter.site without prompting — undefined if unset. For UI that
 * refreshes passively (the sidebar panel) and shouldn't pop a QuickPick on its own. */
export function peekSite(scope: vscode.ConfigurationScope | undefined): SiteId | undefined {
  const configured = vscode.workspace.getConfiguration(CONFIG_SECTION, scope).get<string>('site');
  return isSiteId(configured) ? configured : undefined;
}

/** Reads puzzleSubmitter.site for the given workspace folder, prompting (and persisting) if unset. */
export async function resolveSite(scope: vscode.ConfigurationScope | undefined): Promise<SiteId | undefined> {
  const existing = peekSite(scope);
  if (existing) return existing;
  return promptAndSaveSite(scope);
}

export async function promptAndSaveSite(scope: vscode.ConfigurationScope | undefined): Promise<SiteId | undefined> {
  const picked = await vscode.window.showQuickPick(
    allProviders.map((provider) => ({ label: provider.label, id: provider.id })),
    { title: 'Which puzzle site does this workspace submit to?', placeHolder: 'Select a site' }
  );
  if (!picked) {
    return undefined;
  }
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, scope);
  // puzzleSubmitter.site is declared "window" scope in package.json, which does not
  // support ConfigurationTarget.WorkspaceFolder — only User/Workspace. In the
  // single-folder-per-site setup this extension is built for, Workspace already
  // means "this folder's own .vscode/settings.json", so that's all we need.
  const target = vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await config.update('site', picked.id, target);
  return picked.id;
}
