import * as vscode from 'vscode';
import { PuzzleContext, PuzzleProvider } from '../types';

/** Prompts for group/index/part by hand — used when detection fails, and as the sidebar
 * panel's fallback (it has no manual-entry form of its own, see panelProvider.ts). */
export async function promptManualContext(provider: PuzzleProvider): Promise<PuzzleContext | undefined> {
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
