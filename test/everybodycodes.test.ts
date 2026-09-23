import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSubmitBody } from '../src/providers/everybodycodes';

test('409 means already solved (confirmed from real use)', () => {
  const result = parseSubmitBody(409, '{}');
  assert.equal(result.status, 'already-solved');
});

test('409 with a message field surfaces it', () => {
  const result = parseSubmitBody(409, JSON.stringify({ message: 'Quest already completed' }));
  assert.equal(result.status, 'already-solved');
  assert.equal(result.message, 'Quest already completed');
});

test('2xx + correct:true is correct', () => {
  const result = parseSubmitBody(200, JSON.stringify({ correct: true }));
  assert.equal(result.status, 'correct');
});

test('2xx + correct:false is incorrect', () => {
  const result = parseSubmitBody(200, JSON.stringify({ correct: false }));
  assert.equal(result.status, 'incorrect');
});

test('401/403 is reported as a token problem, not silently unknown', () => {
  assert.match(parseSubmitBody(401, '').message, /token/i);
  assert.match(parseSubmitBody(403, '').message, /token/i);
});

test('unrecognized 2xx shape falls back to unknown with the raw body visible', () => {
  const result = parseSubmitBody(200, '{"somethingElse": true}');
  assert.equal(result.status, 'unknown');
  assert.match(result.message, /somethingElse/);
});
