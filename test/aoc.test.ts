import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAocResponse } from '../src/providers/aoc';

test('correct answer', () => {
  const html = "<p>That's the right answer! You are one gold star closer...</p>";
  assert.equal(parseAocResponse(html).status, 'correct');
});

test('incorrect answer, too high', () => {
  const html = "<p>That's not the right answer; your answer is too high.</p>";
  const result = parseAocResponse(html);
  assert.equal(result.status, 'incorrect');
  assert.match(result.message, /too high/);
});

test('incorrect answer, too low', () => {
  const html = "<p>That's not the right answer; your answer is too low.</p>";
  const result = parseAocResponse(html);
  assert.equal(result.status, 'incorrect');
  assert.match(result.message, /too low/);
});

test('already solved with same answer', () => {
  const html = '<p>You don\'t seem to be solving the right level. Did you already complete it?</p>';
  assert.equal(parseAocResponse(html).status, 'already-solved');
});

test('rate limited', () => {
  const html = '<p>You gave an answer too recently; you have 45s left to wait.</p>';
  const result = parseAocResponse(html);
  assert.equal(result.status, 'rate-limited');
  assert.match(result.message, /45s/);
});

test('unrecognized response falls back to unknown', () => {
  const html = '<p>Something AoC has never said before.</p>';
  assert.equal(parseAocResponse(html).status, 'unknown');
});
