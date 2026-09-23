import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { benchmarkPart } from '../src/core/benchmark';
import { markSolved } from '../src/core/progress';
import { writeLocalInput } from '../src/core/localInput';
import { PuzzleContext, PuzzleProvider } from '../src/types';

// Minimal in-memory stand-in for vscode.Memento — only what progress.ts actually calls.
class FakeMemento {
  private store = new Map<string, unknown>();
  get<T>(key: string, defaultValue: T): T {
    return (this.store.has(key) ? this.store.get(key) : defaultValue) as T;
  }
  async update(key: string, value: unknown): Promise<void> {
    this.store.set(key, value);
  }
  keys(): readonly string[] {
    return [...this.store.keys()];
  }
}

function tmpFolder(): import('vscode').WorkspaceFolder {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'puzzle-submitter-benchmark-test-'));
  return { uri: { fsPath: dir } } as import('vscode').WorkspaceFolder;
}

function writeSolution(folder: import('vscode').WorkspaceFolder, name: string, contents: string): string {
  const file = path.join(folder.uri.fsPath, name);
  fs.writeFileSync(file, contents, 'utf8');
  return file;
}

const provider = { id: 'aoc', label: 'Advent of Code', maxPart: 2, solverInputShape: 'text' } as PuzzleProvider;
const ctx = (overrides: Partial<PuzzleContext> = {}): PuzzleContext => ({ group: '2024', index: '1', part: 1, ...overrides });

test('match: solver output equals the recorded answer', async () => {
  const folder = tmpFolder();
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  const solution = writeSolution(folder, 'day_01.py', 'def solver(data):\n    return len(data)\n');
  writeLocalInput(folder, provider.id, ctx(), { '1': 'hello world' });
  await markSolved(state, provider, ctx(), 1, '11');

  const result = await benchmarkPart(provider, ctx(), solution, 'python3', folder, state);
  assert.deepEqual(result, { status: 'match', computed: '11' });
});

test('mismatch: solver output differs from the recorded answer', async () => {
  const folder = tmpFolder();
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  const solution = writeSolution(folder, 'day_01.py', 'def solver(data):\n    return len(data)\n');
  writeLocalInput(folder, provider.id, ctx(), { '1': 'hello world' });
  await markSolved(state, provider, ctx(), 1, '999');

  const result = await benchmarkPart(provider, ctx(), solution, 'python3', folder, state);
  assert.deepEqual(result, { status: 'mismatch', computed: '11', recorded: '999' });
});

test('no-reference: solver runs fine but nothing was ever recorded for this part', async () => {
  const folder = tmpFolder();
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  const solution = writeSolution(folder, 'day_01.py', 'def solver(data):\n    return len(data)\n');
  writeLocalInput(folder, provider.id, ctx(), { '1': 'hello world' });

  const result = await benchmarkPart(provider, ctx(), solution, 'python3', folder, state);
  assert.deepEqual(result, { status: 'no-reference', computed: '11' });
});

test('no-input: nothing cached locally — benchmarking never fetches over the network to get it', async () => {
  const folder = tmpFolder();
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  const solution = writeSolution(folder, 'day_01.py', 'def solver(data):\n    return len(data)\n');

  const result = await benchmarkPart(provider, ctx(), solution, 'python3', folder, state);
  assert.deepEqual(result, { status: 'no-input' });
});

test('error: solver() raising is surfaced as an error result instead of throwing', async () => {
  const folder = tmpFolder();
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  const solution = writeSolution(folder, 'day_01.py', 'def solver(data):\n    raise ValueError("boom")\n');
  writeLocalInput(folder, provider.id, ctx(), { '1': 'hello world' });

  const result = await benchmarkPart(provider, ctx(), solution, 'python3', folder, state);
  assert.equal(result.status, 'error');
});

test('a provider with no solverInputShape (no runner) is reported as an error, never attempted', async () => {
  const folder = tmpFolder();
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  const solution = writeSolution(folder, 'day_01.py', 'def solver(data):\n    return len(data)\n');
  const noRunnerProvider = { id: 'codyssi', label: 'Codyssi', maxPart: 1 } as PuzzleProvider;

  const result = await benchmarkPart(noRunnerProvider, ctx(), solution, 'python3', folder, state);
  assert.deepEqual(result, { status: 'error', message: 'Codyssi has no solver() runner.' });
});
