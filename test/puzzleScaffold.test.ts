import { test } from 'node:test';
import assert from 'node:assert/strict';
import { genericScaffoldPath, inferPathPrefix, planNewEvent, scaffoldFileContent } from '../src/core/puzzleScaffold';
import { aocProvider } from '../src/providers/aoc';
import { everybodyCodesProvider } from '../src/providers/everybodycodes';
import { codyssiProvider, codingQuestProvider, i18nPuzzlesProvider } from '../src/providers/assistProvider';
import { PuzzleContext } from '../src/types';

const ctx = (overrides: Partial<PuzzleContext> = {}): PuzzleContext => ({ group: '2026', index: '3', part: 1, ...overrides });

test('aoc.scaffoldPath matches the real events/year_YYYY/day_NN/day_NN.py layout, zero-padded', () => {
  assert.equal(aocProvider.scaffoldPath!(ctx()), 'events/year_2026/day_03/day_03.py');
  assert.equal(aocProvider.scaffoldPath!(ctx({ index: '12' })), 'events/year_2026/day_12/day_12.py');
});

test('codyssi.scaffoldPath uses the same day_NN layout as AoC', () => {
  assert.equal(codyssiProvider.scaffoldPath!(ctx()), 'events/year_2026/day_03/day_03.py');
});

test('codingquest.scaffoldPath expects group to already carry the challenge/practice prefix', () => {
  assert.equal(
    codingQuestProvider.scaffoldPath!(ctx({ group: 'challenge_2026' })),
    'events/challenge_2026/day_03/day_03.py'
  );
});

test('i18n-puzzles has no scaffoldPath — flat numbering has no event to scaffold', () => {
  assert.equal(i18nPuzzlesProvider.scaffoldPath, undefined);
});

test('everybodycodes.scaffoldPath: a 4-digit group is a yearly event', () => {
  assert.equal(everybodyCodesProvider.scaffoldPath!(ctx({ group: '2026' })), 'events/year_2026/solutions/quest_03.py');
});

test('everybodycodes.scaffoldPath: a non-4-digit group is a story, padded and under stories/', () => {
  assert.equal(everybodyCodesProvider.scaffoldPath!(ctx({ group: '4' })), 'stories/story_04/solutions/quest_03.py');
});

test('inferPathPrefix finds a repo-specific prefix (e.g. src/everybodycodes/) from a real existing file', () => {
  const existingCtx = ctx({ group: '2024', index: '1' });
  const prefix = inferPathPrefix(
    everybodyCodesProvider,
    existingCtx,
    'src/everybodycodes/events/year_2024/solutions/quest_01.py'
  );
  assert.equal(prefix, 'src/everybodycodes/');
});

test('inferPathPrefix is empty when the canonical path already sits at the workspace root', () => {
  const existingCtx = ctx({ group: '2015', index: '1' });
  const prefix = inferPathPrefix(aocProvider, existingCtx, 'events/year_2015/day_01/day_01.py');
  assert.equal(prefix, '');
});

test("inferPathPrefix is empty when the existing path doesn't actually match the provider's canonical shape", () => {
  const existingCtx = ctx({ group: '2015', index: '1' });
  const prefix = inferPathPrefix(aocProvider, existingCtx, 'some/totally/different/layout.py');
  assert.equal(prefix, '');
});

test('genericScaffoldPath: the "Other" escape hatch, independent of any site convention', () => {
  assert.equal(genericScaffoldPath('2026', 'Puzzle', '3'), 'events/2026/Puzzle_03/Puzzle_03.py');
});

test('planNewEvent uses the real site convention (plus any inferred prefix) when the noun matches itemNoun', () => {
  const plan = planNewEvent(aocProvider, '2026', 'Day', 3, '');
  assert.deepEqual(
    plan.map((p) => p.relativePath),
    ['events/year_2026/day_01/day_01.py', 'events/year_2026/day_02/day_02.py', 'events/year_2026/day_03/day_03.py']
  );
  assert.deepEqual(plan[1].ctx, { group: '2026', index: '2', part: 1 });
});

test('planNewEvent applies an inferred prefix on top of the site convention', () => {
  const plan = planNewEvent(everybodyCodesProvider, '2026', 'Quest', 2, 'src/everybodycodes/');
  assert.deepEqual(
    plan.map((p) => p.relativePath),
    ['src/everybodycodes/events/year_2026/solutions/quest_01.py', 'src/everybodycodes/events/year_2026/solutions/quest_02.py']
  );
});

test('planNewEvent falls back to the generic layout when the noun does not match the site convention', () => {
  const plan = planNewEvent(aocProvider, '2026', 'Other', 2, '');
  assert.deepEqual(
    plan.map((p) => p.relativePath),
    ['events/2026/Other_01/Other_01.py', 'events/2026/Other_02/Other_02.py']
  );
});

test('scaffoldFileContent includes a docstring header and a minimal preprocessing()/solver() stub', () => {
  const content = scaffoldFileContent(aocProvider, ctx({ group: '2026', index: '5' }));
  assert.match(content, /Advent of Code - 2026 - Day 5/);
  assert.match(content, /https:\/\/adventofcode\.com\/2026\/day\/5/);
  assert.match(content, /def preprocessing\(data\):/);
  assert.match(content, /def solver\(data\):/);
  assert.match(content, /raise NotImplementedError/);
});
