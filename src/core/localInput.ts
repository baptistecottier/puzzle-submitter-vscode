import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { PuzzleContext, PuzzleInputParts, SaveInputFile, SiteId } from '../types';

/** One JSON file per site: { "<group>": { "<index>": { "1": "...", "2": "..." } } }. */
type SiteInputStore = Record<string, Record<string, PuzzleInputParts>>;

/** Workspace-relative path to a site's single consolidated input cache. */
export function siteInputPath(siteId: SiteId): string {
  return `.puzzle-submitter/${siteId}.json`;
}

function absoluteSiteInputPath(folder: vscode.WorkspaceFolder, siteId: SiteId): string {
  return path.join(folder.uri.fsPath, siteInputPath(siteId));
}

function readSiteStore(folder: vscode.WorkspaceFolder, siteId: SiteId): SiteInputStore {
  const file = absoluteSiteInputPath(folder, siteId);
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as SiteInputStore;
    }
  } catch {
    // corrupt file — treat as empty rather than crashing the extension
  }
  return {};
}

function writeSiteStore(folder: vscode.WorkspaceFolder, siteId: SiteId, store: SiteInputStore): void {
  const file = absoluteSiteInputPath(folder, siteId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2), 'utf8');
}

/** Whether this site has any locally cached input at all in this workspace. */
export function hasLocalInput(folder: vscode.WorkspaceFolder, siteId: SiteId): boolean {
  return fs.existsSync(absoluteSiteInputPath(folder, siteId));
}

/** Deletes this site's entire consolidated input cache — every puzzle, not just one.
 * Input is fetched per-account (e.g. AoC/EC personalize it), so switching to a
 * different account's token without clearing this would keep showing the old
 * account's input as if it belonged to the new one. */
export function clearLocalInput(folder: vscode.WorkspaceFolder, siteId: SiteId): void {
  const file = absoluteSiteInputPath(folder, siteId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

/** Whatever's cached locally for this puzzle, if anything. */
export function readLocalInput(
  folder: vscode.WorkspaceFolder,
  siteId: SiteId,
  ctx: PuzzleContext
): PuzzleInputParts | undefined {
  return readSiteStore(folder, siteId)[ctx.group]?.[ctx.index];
}

/** Merges `parts` into this puzzle's entry in the site's store — never drops other
 * parts, or other puzzles, already saved. */
export function writeLocalInput(
  folder: vscode.WorkspaceFolder,
  siteId: SiteId,
  ctx: PuzzleContext,
  parts: PuzzleInputParts
): void {
  const store = readSiteStore(folder, siteId);
  store[ctx.group] = store[ctx.group] ?? {};
  store[ctx.group][ctx.index] = { ...store[ctx.group][ctx.index], ...parts };
  writeSiteStore(folder, siteId, store);
}

/** Where a site's non-text inputs (images) go: .puzzle-submitter/<site>-files/<name>. */
export function inputFileSaver(folder: vscode.WorkspaceFolder, siteId: SiteId): SaveInputFile {
  return (name, data) => {
    const relative = `.puzzle-submitter/${siteId}-files/${name}`;
    const file = path.join(folder.uri.fsPath, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
    return relative;
  };
}
