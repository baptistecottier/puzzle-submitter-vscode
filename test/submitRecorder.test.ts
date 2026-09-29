import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordSubmitResult, describeSubmitResult } from '../src/core/submitRecorder';
import { getRecordedAnswer, getSolvedParts } from '../src/core/progress';
import { PuzzleContext, PuzzleProvider, SubmitResult } from '../src/types';

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

const ctx: PuzzleContext = { group: '2024', index: '5', part: 2 };

test('recordSubmitResult: "correct" records the submitted answer and returns it', async () => {
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  const provider = { id: 'aoc' } as PuzzleProvider;
  const result: SubmitResult = { status: 'correct', message: "That's the right answer!" };

  const recovered = await recordSubmitResult(state, provider, ctx, '42', result, 'token', 'contact');

  assert.equal(recovered, '42');
  assert.equal(getRecordedAnswer(state, provider, ctx, 2), '42');
});

test('recordSubmitResult: "already-solved" recovers the real answer via fetchRecordedAnswers', async () => {
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  const provider = {
    id: 'everybodycodes',
    fetchRecordedAnswers: async () => ['10', '20', '30'],
  } as unknown as PuzzleProvider;
  const result: SubmitResult = { status: 'already-solved', message: 'Already solved.' };

  // ctx.part is 2 -> answers[1] -> '20'
  const recovered = await recordSubmitResult(state, provider, ctx, '999', result, 'token', 'contact');

  assert.equal(recovered, '20');
  assert.equal(getRecordedAnswer(state, provider, ctx, 2), '20');
});

test('recordSubmitResult: "already-solved" with no fetchRecordedAnswers still marks solved, with no answer text', async () => {
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  const provider = { id: 'codyssi' } as PuzzleProvider;
  const result: SubmitResult = { status: 'already-solved', message: 'Already solved.' };

  const recovered = await recordSubmitResult(state, provider, ctx, '999', result, 'token', 'contact');

  assert.equal(recovered, undefined);
  assert.deepEqual(getSolvedParts(state, provider, ctx), [2]);
  assert.equal(getRecordedAnswer(state, provider, ctx, 2), undefined);
});

test('recordSubmitResult: "already-solved" still marks solved even if fetchRecordedAnswers throws', async () => {
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  const provider = {
    id: 'everybodycodes',
    fetchRecordedAnswers: async () => {
      throw new Error('network blip');
    },
  } as unknown as PuzzleProvider;
  const result: SubmitResult = { status: 'already-solved', message: 'Already solved.' };

  const recovered = await recordSubmitResult(state, provider, ctx, '999', result, 'token', 'contact');

  assert.equal(recovered, undefined);
  assert.deepEqual(getSolvedParts(state, provider, ctx), [2]);
});

test('recordSubmitResult: no-ops for any other status', async () => {
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  const provider = { id: 'aoc' } as PuzzleProvider;
  const result: SubmitResult = { status: 'incorrect', message: 'Wrong.' };

  const recovered = await recordSubmitResult(state, provider, ctx, '999', result, 'token', 'contact');

  assert.equal(recovered, undefined);
  assert.deepEqual(getSolvedParts(state, provider, ctx), []);
});

test('describeSubmitResult: appends the recorded answer when it differs from what was submitted', () => {
  const result: SubmitResult = { status: 'already-solved', message: 'Already solved.' };
  assert.equal(describeSubmitResult(result, '999', '20'), 'Already solved. (recorded answer: 20)');
});

test('describeSubmitResult: leaves the message alone when the recorded answer matches what was submitted', () => {
  const result: SubmitResult = { status: 'already-solved', message: 'Already solved.' };
  assert.equal(describeSubmitResult(result, '20', '20'), 'Already solved.');
});

test('describeSubmitResult: leaves the message alone when nothing was recovered', () => {
  const result: SubmitResult = { status: 'already-solved', message: 'Already solved.' };
  assert.equal(describeSubmitResult(result, '999', undefined), 'Already solved.');
});

test('describeSubmitResult: never touches the message for a "correct" result', () => {
  const result: SubmitResult = { status: 'correct', message: "That's the right answer!" };
  assert.equal(describeSubmitResult(result, '42', '42'), "That's the right answer!");
});
