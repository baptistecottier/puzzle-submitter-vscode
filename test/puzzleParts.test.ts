import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maxPartFor } from '../src/core/puzzleParts';
import { PuzzleContext, PuzzleProvider } from '../src/types';

const ctx: PuzzleContext = { group: '2024', index: '5', part: 1 };

test('maxPartFor falls back to provider.maxPart when maxPartFor is not implemented', () => {
  const provider = { maxPart: 2 } as PuzzleProvider;
  assert.equal(maxPartFor(provider, ctx), 2);
});

test('maxPartFor defers to the provider override when implemented', () => {
  const provider = { maxPart: 2, maxPartFor: () => 1 } as unknown as PuzzleProvider;
  assert.equal(maxPartFor(provider, ctx), 1);
});

test('maxPartFor passes the exact ctx through to the provider override', () => {
  let received: PuzzleContext | undefined;
  const provider = {
    maxPart: 2,
    maxPartFor: (c: PuzzleContext) => {
      received = c;
      return 1;
    },
  } as unknown as PuzzleProvider;
  maxPartFor(provider, ctx);
  assert.deepEqual(received, ctx);
});
