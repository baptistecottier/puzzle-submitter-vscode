import * as vscode from 'vscode';
import { PuzzleContext, PuzzleProvider, SiteId } from '../types';
import { readLocalInput } from './localInput';
import { isGridosGroup } from '../providers/everybodycodes';

/** Read-only tabs showing one puzzle part's cached input, for reading it at full size —
 * unlike an untitled document, closing one never asks to save. The URI carries which
 * input it is; the text is always read fresh from the cache (see ./localInput). */
const SCHEME = 'puzzle-submitter-input';

interface InputRef {
  folder: string;
  site: SiteId;
  group: string;
  index: string;
  part: number;
}

const changed = new vscode.EventEmitter<vscode.Uri>();

export function registerInputDocuments(): vscode.Disposable {
  return vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
    onDidChange: changed.event,
    provideTextDocumentContent(uri) {
      const ref = JSON.parse(uri.query) as InputRef;
      const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(ref.folder));
      if (!folder) return '';
      const text = readLocalInput(folder, ref.site, { group: ref.group, index: ref.index, part: ref.part })?.[String(ref.part)] ?? '';
      // A GridOS part's input is its test cases as one line of JSON — shown laid out.
      if (ref.site === 'everybodycodes' && isGridosGroup(ref.group)) {
        try {
          return JSON.stringify(JSON.parse(text), null, 2);
        } catch {
          return text;
        }
      }
      return text;
    },
  });
}

export function inputDocumentUri(folder: vscode.WorkspaceFolder, provider: PuzzleProvider, ctx: PuzzleContext): vscode.Uri {
  const ref: InputRef = { folder: folder.uri.toString(), site: provider.id, group: ctx.group, index: ctx.index, part: ctx.part };
  const title = `Input — ${[ctx.group, `${provider.itemNoun} ${ctx.index}`].filter(Boolean).join(' ')}, part ${ctx.part}`;
  return vscode.Uri.from({ scheme: SCHEME, path: `/${title}`, query: JSON.stringify(ref) });
}

/** Re-reads every open input tab — after the cache was written (fetched, edited). */
export function refreshInputDocuments(): void {
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.scheme === SCHEME) changed.fire(doc.uri);
  }
}
