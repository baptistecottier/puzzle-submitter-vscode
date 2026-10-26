import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSubmitBody, parseQuestAnswers, everybodyCodesProvider, signedInSeed, parseGridosBest } from '../src/providers/everybodycodes';

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

test('parseQuestAnswers: all three parts solved, in order (real response shape)', () => {
  const data = {
    penaltyUntil: '1789743034464',
    penaltyLeftMs: '0',
    key1: 'j9OrQENR-y@(S^VI&fM>(0]x}00r<37t',
    answer1: '1341',
    key2: 'Z{T@!t|CxdeO#%;+6!O||p6@0$LsakVm',
    answer2: '5568',
    key3: 'i)={3y^)a&Z1L+HnbVsUEw}CVvxc@_QF',
    answer3: '28337',
  };
  assert.deepEqual(parseQuestAnswers(data), ['1341', '5568', '28337']);
});

test('parseQuestAnswers: only the first part unlocked/solved so far', () => {
  const data = { key1: 'some-key', answer1: '42' };
  assert.deepEqual(parseQuestAnswers(data), ['42']);
});

test('parseQuestAnswers: nothing solved yet returns an empty list', () => {
  assert.deepEqual(parseQuestAnswers({}), []);
});

test('groupSortKey: years, stories and GridOS never interleave — a real reported bug', () => {
  // Plain lexicographic sort of these raw groups gives "1","2","2024","2025","3","4",
  // "gridos-1" -> Story 1, Story 2, 2024, 2025, Story 3, Story 4, GridOS 1 (interleaved).
  const groups = ['1', '2', '2024', '2025', '3', '4', '3001'];
  const sorted = [...groups].sort((a, b) =>
    everybodyCodesProvider.groupSortKey!(a).localeCompare(everybodyCodesProvider.groupSortKey!(b))
  );
  assert.deepEqual(sorted, ['2024', '2025', '1', '2', '3', '4', '3001']);
});

test("signedInSeed: an expired/invalid token's logged-out /user/me (HTTP 200, id null — real response) is an error, not a silent partial fetch", () => {
  assert.throws(() => signedInSeed({ id: null, name: null, serverTime: 1792153909575 } as { id: null }), /probably expired/);
});

test('signedInSeed: a signed-in /user/me gives its seed', () => {
  assert.equal(signedInSeed({ id: 6053, seed: 41 }), 41);
});

test('GridOS files are GridOS N = event 3000 + N on the site, with the part from the part_I/II/III folder', () => {
  const detect = everybodyCodesProvider.detect;
  assert.deepEqual(detect('src/gridos/gridos_01/quest_3/part_II/q3p2_heads.rules'), { group: '3001', index: '3', part: 2 });
  assert.deepEqual(detect('src/gridos/gridos_01/quest_3/part_III/q3p3_steps.rules'), { group: '3001', index: '3', part: 3 });
  assert.deepEqual(detect('src/gridos/gridos_01/quest_5/postprocessing.py'), { group: '3001', index: '5', part: 1 });
  const ctx = { group: '3001', index: '3', part: 2 };
  assert.equal(everybodyCodesProvider.groupLabel!('3001'), 'GridOS 1');
  assert.equal(everybodyCodesProvider.puzzleUrl(ctx), 'https://everybody.codes/gridos/1/quests/3');
  assert.equal(everybodyCodesProvider.supportsRunner!(ctx), false);
});

test("parseGridosBest reads a GridOS part's recorded answer — the JSON of your best scores", () => {
  assert.deepEqual(parseGridosBest('{"heads":1,"states":200,"rules":484,"steps":2620,"golf":6}'), { heads: 1, states: 200, rules: 484, steps: 2620, golf: 6 });
  assert.equal(parseGridosBest('42'), undefined);
  assert.equal(parseGridosBest(undefined), undefined);
});
