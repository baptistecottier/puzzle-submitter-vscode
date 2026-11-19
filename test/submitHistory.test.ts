import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearSubmissionHistory,
  describePastSubmission,
  findPastSubmission,
  getSubmissionHistory,
  hasSubmissionHistory,
  recordSubmission,
  setVerdict,
} from '../src/core/submitHistory';
import { getRecordedAnswer } from '../src/core/progress';
import { recordSubmitResult } from '../src/core/submitRecorder';
import { PuzzleContext, PuzzleProvider } from '../src/types';

class FakeMemento {
  private store = new Map<string, unknown>();
  get<T>(key: string, defaultValue: T): T {
    return (this.store.has(key) ? this.store.get(key) : defaultValue) as T;
  }
  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) this.store.delete(key);
    else this.store.set(key, value);
  }
  keys(): readonly string[] {
    return [...this.store.keys()];
  }
}

const memento = () => new FakeMemento() as unknown as import('vscode').Memento;
const provider = { id: 'aoc' } as PuzzleProvider;
const ctx: PuzzleContext = { group: '2024', index: '5', part: 1 };

test('a wrong answer is remembered with what the site said, whichever way it was typed', async () => {
  const state = memento();
  await recordSubmitResult(state, provider, ctx, '42', { status: 'incorrect', message: 'too high' }, 't', 'c');
  const past = findPastSubmission(state, provider, ctx, ' 42 ');
  assert.equal(past?.status, 'incorrect');
  assert.match(describePastSubmission(past!), /"42" was already sent on .*: too high\.$/);
  assert.equal(findPastSubmission(state, provider, ctx, '43'), undefined);
});

test('history is per part, newest first, with one entry per answer', async () => {
  const state = memento();
  await recordSubmission(state, provider, ctx, '1', 'incorrect');
  await recordSubmission(state, provider, ctx, '2', 'incorrect');
  await recordSubmission(state, provider, ctx, '1', 'correct');
  assert.deepEqual(getSubmissionHistory(state, provider, ctx).map((e) => [e.answer, e.status]), [['1', 'correct'], ['2', 'incorrect']]);
  assert.deepEqual(getSubmissionHistory(state, provider, { ...ctx, part: 2 }), []);
});

test("a rate-limited submission was never judged, so it isn't history", async () => {
  const state = memento();
  await recordSubmitResult(state, provider, ctx, '42', { status: 'rate-limited', message: 'wait' }, 't', 'c');
  assert.deepEqual(getSubmissionHistory(state, provider, ctx), []);
});

test("a copied answer is remembered with its result unknown, and clearing removes only that site's history", async () => {
  const state = memento();
  const other = { id: 'codyssi' } as PuzzleProvider;
  await recordSubmission(state, provider, ctx, '7', 'copied');
  await recordSubmission(state, other, ctx, '8', 'copied');
  assert.match(describePastSubmission(findPastSubmission(state, provider, ctx, '7')!), /result is unknown/);
  await clearSubmissionHistory(state, provider);
  assert.equal(hasSubmissionHistory(state, provider), false);
  assert.equal(hasSubmissionHistory(state, other), true);
});

test('marking a copied answer right solves the part with it; taking it back unsolves it', async () => {
  const state = memento();
  await recordSubmission(state, provider, ctx, '61110', 'copied');
  await recordSubmission(state, provider, ctx, '4850', 'copied');
  await setVerdict(state, provider, ctx, '4850', 'incorrect');
  await setVerdict(state, provider, ctx, '61110', 'correct');
  assert.deepEqual(getSubmissionHistory(state, provider, ctx).map((e) => [e.answer, e.status]), [['4850', 'incorrect'], ['61110', 'correct']]);
  assert.equal(getRecordedAnswer(state, provider, ctx, 1), '61110');
  await setVerdict(state, provider, ctx, '61110', 'copied');
  assert.equal(getRecordedAnswer(state, provider, ctx, 1), undefined);
});
