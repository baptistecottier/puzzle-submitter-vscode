import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkAgainstRecorded,
  getRecordedAnswer,
  getSolvedParts,
  listSolvedPuzzles,
  markSolved,
  nextUnsolvedPart,
  summarizeSolvedByGroup,
} from '../src/core/progress';
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
const providerWithParts = { id: 'aoc', maxPart: 2 } as PuzzleProvider;

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

test('markSolved records the actual answer text for a fresh "correct" result', async () => {
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  const ctx = { group: '2024', index: '7', part: 1 };
  await markSolved(state, fakeProvider, ctx, 1, '42');
  assert.equal(getRecordedAnswer(state, fakeProvider, ctx, 1), '42');
});

test('markSolved without an answer marks the part solved but leaves no comparable answer', async () => {
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  const ctx = { group: '2024', index: '7', part: 1 };
  await markSolved(state, fakeProvider, ctx, 1);
  assert.deepEqual(getSolvedParts(state, fakeProvider, ctx), [1]);
  assert.equal(getRecordedAnswer(state, fakeProvider, ctx, 1), undefined);
});

test('markSolved never downgrades a confirmed answer when a later call omits one (e.g. "already-solved")', async () => {
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  const ctx = { group: '2024', index: '7', part: 1 };
  await markSolved(state, fakeProvider, ctx, 1, '42');
  await markSolved(state, fakeProvider, ctx, 1);
  assert.equal(getRecordedAnswer(state, fakeProvider, ctx, 1), '42');
});

test('an old number[]-format entry (pre-answer-tracking) still counts as solved, with no recorded answer', async () => {
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  await state.update('puzzleSubmitter.progress.aoc.2023.5', [1, 2]);
  const ctx = { group: '2023', index: '5', part: 1 };
  assert.deepEqual(getSolvedParts(state, fakeProvider, ctx), [1, 2]);
  assert.equal(getRecordedAnswer(state, fakeProvider, ctx, 1), undefined);
  assert.equal(getRecordedAnswer(state, fakeProvider, ctx, 2), undefined);
});

test('listSolvedPuzzles also recognizes old number[]-format entries', async () => {
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  await state.update('puzzleSubmitter.progress.aoc.2023.5', [1, 2]);
  assert.deepEqual(listSolvedPuzzles(state, fakeProvider), [{ group: '2023', index: '5', parts: [1, 2] }]);
});

test('nextUnsolvedPart finds the first gap, old-format entries included', async () => {
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  await state.update('puzzleSubmitter.progress.aoc.2023.5', [1]);
  const ctx = { group: '2023', index: '5', part: 1 };
  assert.equal(nextUnsolvedPart(state, providerWithParts, ctx), 2);
});

test('nextUnsolvedPart defaults to the last part once everything is solved', async () => {
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  const ctx = { group: '2023', index: '5', part: 1 };
  await markSolved(state, providerWithParts, ctx, 1, 'a');
  await markSolved(state, providerWithParts, ctx, 2, 'b');
  assert.equal(nextUnsolvedPart(state, providerWithParts, ctx), 2);
});

test('nextUnsolvedPart respects a per-puzzle maxPartFor override (e.g. AoC day 25/12 having only one part)', async () => {
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  const lastDayProvider = {
    id: 'aoc',
    maxPart: 2,
    maxPartFor: (c: { index: string }) => (c.index === '25' ? 1 : 2),
  } as unknown as PuzzleProvider;

  const normalDay = { group: '2023', index: '10', part: 1 };
  assert.equal(nextUnsolvedPart(state, lastDayProvider, normalDay), 1);
  await markSolved(state, lastDayProvider, normalDay, 1, 'a');
  assert.equal(nextUnsolvedPart(state, lastDayProvider, normalDay), 2);

  const lastDay = { group: '2023', index: '25', part: 1 };
  assert.equal(nextUnsolvedPart(state, lastDayProvider, lastDay), 1);
  await markSolved(state, lastDayProvider, lastDay, 1, 'z');
  // Everything (the single part) is solved — defaults to 1, not the provider's
  // general maxPart of 2, which day 25 never actually has.
  assert.equal(nextUnsolvedPart(state, lastDayProvider, lastDay), 1);
});

test('checkAgainstRecorded: no-reference when nothing is recorded for this part', () => {
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  const ctx = { group: '2024', index: '9', part: 1 };
  assert.equal(checkAgainstRecorded(state, fakeProvider, ctx, '42'), 'no-reference');
});

test('checkAgainstRecorded: no-reference when the part is solved but has no answer text (e.g. old already-solved)', async () => {
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  const ctx = { group: '2024', index: '9', part: 1 };
  await markSolved(state, fakeProvider, ctx, 1); // no answer -> stored as `true`
  assert.equal(checkAgainstRecorded(state, fakeProvider, ctx, '42'), 'no-reference');
});

test('checkAgainstRecorded: match when the candidate equals the recorded answer', async () => {
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  const ctx = { group: '2024', index: '9', part: 1 };
  await markSolved(state, fakeProvider, ctx, 1, '42');
  assert.equal(checkAgainstRecorded(state, fakeProvider, ctx, '42'), 'match');
});

test('checkAgainstRecorded: mismatch when the candidate differs from the recorded answer', async () => {
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  const ctx = { group: '2024', index: '9', part: 1 };
  await markSolved(state, fakeProvider, ctx, 1, '42');
  assert.equal(checkAgainstRecorded(state, fakeProvider, ctx, '43'), 'mismatch');
});

test('summarizeSolvedByGroup is empty when nothing has been solved', () => {
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  assert.deepEqual(summarizeSolvedByGroup(state, fakeProvider), []);
});

test('summarizeSolvedByGroup collapses many solved days into one entry per group, counting puzzles and stars separately', async () => {
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  await markSolved(state, fakeProvider, { group: '2015', index: '1', part: 1 }, 1, 'a');
  await markSolved(state, fakeProvider, { group: '2015', index: '1', part: 1 }, 2, 'b');
  await markSolved(state, fakeProvider, { group: '2015', index: '2', part: 1 }, 1, 'c'); // only part 1
  await markSolved(state, fakeProvider, { group: '2022', index: '1', part: 1 }, 1, 'd');

  assert.deepEqual(summarizeSolvedByGroup(state, fakeProvider), [
    { group: '2015', label: '2015', puzzles: 2, stars: 3 },
    { group: '2022', label: '2022', puzzles: 1, stars: 1 },
  ]);
});

test('summarizeSolvedByGroup uses the provider\'s groupLabel when it has one', async () => {
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  const gridosProvider = {
    id: 'everybodycodes',
    groupLabel: (group: string) => 'GridOS ' + group.replace('gridos-', ''),
  } as PuzzleProvider;
  await markSolved(state, gridosProvider, { group: 'gridos-1', index: '1', part: 1 }, 1, 'a');
  assert.deepEqual(summarizeSolvedByGroup(state, gridosProvider), [
    { group: 'gridos-1', label: 'GridOS 1', puzzles: 1, stars: 1 },
  ]);
});

test('summarizeSolvedByGroup never mixes different providers', async () => {
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  await markSolved(state, fakeProvider, { group: '2024', index: '1', part: 1 }, 1, 'a');
  await markSolved(state, otherProvider, { group: '2024', index: '1', part: 1 }, 1, 'b');
  assert.deepEqual(summarizeSolvedByGroup(state, fakeProvider), [{ group: '2024', label: '2024', puzzles: 1, stars: 1 }]);
});
