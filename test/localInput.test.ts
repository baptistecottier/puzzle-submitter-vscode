import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readLocalInput, siteInputPath, writeLocalInput } from '../src/core/localInput';
import { PuzzleContext, SiteId } from '../src/types';

function tmpFolder(): import('vscode').WorkspaceFolder {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'puzzle-submitter-localinput-test-'));
  return { uri: { fsPath: dir } } as import('vscode').WorkspaceFolder;
}

const ctx = (overrides: Partial<PuzzleContext> = {}): PuzzleContext => ({ group: '2024', index: '1', part: 1, ...overrides });

test('reading before anything is set returns undefined', () => {
  const folder = tmpFolder();
  assert.equal(readLocalInput(folder, 'aoc', ctx()), undefined);
});

test('write then read round-trips for one puzzle', () => {
  const folder = tmpFolder();
  writeLocalInput(folder, 'aoc', ctx(), { '1': 'first part input' });
  assert.deepEqual(readLocalInput(folder, 'aoc', ctx()), { '1': 'first part input' });
});

test('writing part 2 does not drop part 1 already saved for the same puzzle', () => {
  const folder = tmpFolder();
  writeLocalInput(folder, 'everybodycodes', ctx({ index: '3' }), { '1': 'first' });
  writeLocalInput(folder, 'everybodycodes', ctx({ index: '3' }), { '2': 'second' });
  assert.deepEqual(readLocalInput(folder, 'everybodycodes', ctx({ index: '3' })), { '1': 'first', '2': 'second' });
});

test('different puzzles (index) in the same site file stay independent', () => {
  const folder = tmpFolder();
  writeLocalInput(folder, 'codyssi', ctx({ group: '2024', index: '1' }), { '1': 'day one' });
  writeLocalInput(folder, 'codyssi', ctx({ group: '2024', index: '2' }), { '1': 'day two' });
  assert.deepEqual(readLocalInput(folder, 'codyssi', ctx({ group: '2024', index: '1' })), { '1': 'day one' });
  assert.deepEqual(readLocalInput(folder, 'codyssi', ctx({ group: '2024', index: '2' })), { '1': 'day two' });
});

test('an empty group (e.g. i18n-puzzles) is a valid key, not dropped', () => {
  const folder = tmpFolder();
  writeLocalInput(folder, 'i18n-puzzles', ctx({ group: '', index: '5' }), { '1': 'flat numbering input' });
  assert.deepEqual(readLocalInput(folder, 'i18n-puzzles', ctx({ group: '', index: '5' })), { '1': 'flat numbering input' });
});

test('different sites never share or clobber each other, even reusing the same group/index', () => {
  const folder = tmpFolder();
  writeLocalInput(folder, 'aoc', ctx(), { '1': 'aoc input' });
  writeLocalInput(folder, 'codyssi', ctx(), { '1': 'codyssi input' });
  assert.deepEqual(readLocalInput(folder, 'aoc', ctx()), { '1': 'aoc input' });
  assert.deepEqual(readLocalInput(folder, 'codyssi', ctx()), { '1': 'codyssi input' });
});

test('a corrupt site file reads as undefined instead of throwing', () => {
  const folder = tmpFolder();
  const file = path.join(folder.uri.fsPath, siteInputPath('aoc' as SiteId));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'not json at all', 'utf8');
  assert.equal(readLocalInput(folder, 'aoc', ctx()), undefined);
});

test('siteInputPath is one file per site, not per puzzle', () => {
  assert.equal(siteInputPath('aoc'), '.puzzle-submitter/aoc.json');
  assert.equal(siteInputPath('everybodycodes'), '.puzzle-submitter/everybodycodes.json');
});
