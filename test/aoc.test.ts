import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAocResponse, parseRecordedAnswers, aocProvider } from '../src/providers/aoc';

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

test('parseRecordedAnswers: both parts solved, in part order (real AoC layout, answer wraps onto its own line)', () => {
  // Ported from an actual "View Source" of a solved AoC day: "was" and <code> are
  // separated by a newline + indentation, not a single space — a real bug once made the
  // parser miss every answer because of this exact formatting.
  const html = `
    <article class="day-desc"><h2>--- Day 1: Something ---</h2></article>
    <p>
        Your puzzle answer was
        <code>74</code>
        .
    </p>
    <article class="day-desc"><h2 id="part2">--- Part Two ---</h2></article>
    <p>
        Your puzzle answer was
        <code>1795</code>
        .
    </p>
    <p class="day-success">Both parts of this puzzle are complete! They provide two gold stars: **</p>
  `;
  assert.deepEqual(parseRecordedAnswers(html), ['74', '1795']);
});

test('parseRecordedAnswers: only part 1 solved', () => {
  const html = `
    <p>
        Your puzzle answer was
        <code>142</code>
        .
    </p>
    <article class="day-desc"><h2 id="part2">--- Part Two ---</h2></article>
  `;
  assert.deepEqual(parseRecordedAnswers(html), ['142']);
});

test('parseRecordedAnswers: nothing solved yet returns an empty list, ignoring unrelated <code> in the puzzle text', () => {
  const html = '<article class="day-desc"><p>He starts on the ground floor (floor <code>0</code>).</p></article>';
  assert.deepEqual(parseRecordedAnswers(html), []);
});

test('maxPartFor: a normal day (2015-2024) has 2 parts', () => {
  assert.equal(aocProvider.maxPartFor!({ group: '2023', index: '10', part: 1 }), 2);
});

test('maxPartFor: day 25 (2015-2024) has only 1 part — it unlocks once every other star is collected', () => {
  assert.equal(aocProvider.maxPartFor!({ group: '2023', index: '25', part: 1 }), 1);
});

test('maxPartFor: a normal day from 2025 onward has 2 parts', () => {
  assert.equal(aocProvider.maxPartFor!({ group: '2025', index: '10', part: 1 }), 2);
});

test('maxPartFor: the event shortened to 12 days starting in 2025 — day 12 is the new single-part last day', () => {
  assert.equal(aocProvider.maxPartFor!({ group: '2025', index: '12', part: 1 }), 1);
});

test('maxPartFor: day 25 is a normal 2-part day again from 2025 onward (12 is the new "last", not 25)', () => {
  assert.equal(aocProvider.maxPartFor!({ group: '2025', index: '25', part: 1 }), 2);
});
