import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { PuzzleInputParts } from '../types';

/** Reads a puzzle's local input cache as JSON {"1": "...", "2": "...", ...}. */
export function readJsonParts(absolutePath: string): PuzzleInputParts | undefined {
  if (!fs.existsSync(absolutePath)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as PuzzleInputParts;
    }
  } catch {
    // fall through
  }
  return undefined;
}

/** Merges `parts` into whatever's already cached at `absolutePath` and writes it back —
 * setting/fetching one part never drops other parts already saved for this puzzle. */
export function writeJsonParts(absolutePath: string, parts: PuzzleInputParts): void {
  const existing = readJsonParts(absolutePath) ?? {};
  const merged = { ...existing, ...parts };
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, JSON.stringify(merged, null, 2), 'utf8');
}

export function resolveLocalInputPath(folder: vscode.WorkspaceFolder, relativePath: string): string {
  return path.join(folder.uri.fsPath, relativePath);
}
