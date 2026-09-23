import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listSolvedPuzzles, markSolved } from '../src/core/progress';
import { PuzzleProvider } from '../src/types';

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

const fakeProvider = { id: 'aoc' } as PuzzleProvider;
const otherProvider = { id: 'everybodycodes' } as PuzzleProvider;

test('listSolvedPuzzles is empty when nothing has been solved', () => {
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  assert.deepEqual(listSolvedPuzzles(state, fakeProvider), []);
});

test('listSolvedPuzzles reflects marked parts, sorted by index', async () => {
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  await markSolved(state, fakeProvider, { group: '2024', index: '10', part: 1 }, 1);
  await markSolved(state, fakeProvider, { group: '2024', index: '3', part: 1 }, 1);
  await markSolved(state, fakeProvider, { group: '2024', index: '3', part: 1 }, 2);

  assert.deepEqual(listSolvedPuzzles(state, fakeProvider), [
    { group: '2024', index: '3', parts: [1, 2] },
    { group: '2024', index: '10', parts: [1] },
  ]);
});

test('listSolvedPuzzles handles an empty group (e.g. i18n-puzzles)', async () => {
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  await markSolved(state, fakeProvider, { group: '', index: '5', part: 1 }, 1);
  assert.deepEqual(listSolvedPuzzles(state, fakeProvider), [{ group: '', index: '5', parts: [1] }]);
});

test("listSolvedPuzzles never mixes different providers' progress", async () => {
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  await markSolved(state, fakeProvider, { group: '2024', index: '1', part: 1 }, 1);
  await markSolved(state, otherProvider, { group: '2024', index: '1', part: 1 }, 1);

  assert.deepEqual(listSolvedPuzzles(state, fakeProvider), [{ group: '2024', index: '1', parts: [1] }]);
  assert.deepEqual(listSolvedPuzzles(state, otherProvider), [{ group: '2024', index: '1', parts: [1] }]);
});
