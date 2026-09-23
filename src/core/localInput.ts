import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { PuzzleContext, PuzzleInputParts, SiteId } from '../types';

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
