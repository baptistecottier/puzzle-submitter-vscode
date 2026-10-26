import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridosGolf, GridosPart, runGridos } from '../src/core/gridos';

const limits = { heads: 10, states: 1000, rules: 10000, steps: 1000, bytes: 100000 };
const line = (data: string, expected: string, validate = 'TEXT'): GridosPart => ({
  limits,
  cases: [{ startPoints: { A: { x: 0, y: 0 }, B: { x: data.length - 1, y: 0 } }, data, expected, validate }],
});

// The site tutorial's first solution: one head, from the right end, lowercasing QUACK.
const lowercase = ['HEADS B', '', 'START Q START q L', 'START U START u L', 'START A START a L', 'START C START c L', 'START K START k L', 'START _ STOP * R'].join('\n');

test('a program reaching STOP passes, scored like the site: heads, states and rules used, steps, golf', () => {
  const result = runGridos(lowercase, line('QUACK', 'quack'));
  assert.equal(result.allPassed, true);
  assert.deepEqual(result.scores, { heads: 1, states: 2, rules: 6, steps: 6, golf: 7 });
});

test('no matching rule is an error, not a quiet halt — a program has to reach STOP', () => {
  const result = runGridos(lowercase, line('QUAX', 'quax'));
  assert.equal(result.allPassed, false);
  assert.equal(result.cases[0].error, '[ ERROR 404 ] Missing rule for state START and data X');
});

test('more than one matching rule is an error, not "first rule wins"', () => {
  const program = 'HEADS A\nSTART * STOP * S\nSTART Q STOP * S';
  assert.equal(runGridos(program, line('Q', 'Q')).cases[0].error, '[ ERROR 500 ] Multiple rules for state START and data Q');
});

test('"!" matches any non-blank cell, "*" anything, "_" a blank one', () => {
  const program = 'HEADS A\nSTART ! START x R\nSTART _ STOP * S';
  assert.equal(runGridos(program, line('AB', 'xx')).allPassed, true);
});

test('writing "_" erases the cell; EXACT compares the filled area, blanks as "_", empty rows dropped', () => {
  // Erase the middle of ABC, then go down a row and leave it empty.
  const program = 'HEADS A\nSTART A S1 * R\nS1 B S2 _ D\nS2 _ STOP * S';
  const part: GridosPart = { limits, cases: [{ startPoints: { A: { x: 0, y: 0 } }, data: 'ABC', expected: 'A_C', validate: 'EXACT' }] };
  const result = runGridos(program, part);
  assert.equal(result.cases[0].output, 'A_C');
  assert.equal(result.allPassed, true);
});

test('TEXT joins the filled cells without separators or blanks', () => {
  const part: GridosPart = { limits, cases: [{ startPoints: { A: { x: 0, y: 0 } }, data: 'A_\n_B', expected: 'AB', validate: 'TEXT' }] };
  assert.equal(runGridos('HEADS A\nSTART * STOP * S', part).allPassed, true);
});

test('"//" comments, "/" separators and columns past the fifth are ignored, as on the site', () => {
  const program = '// leading comment\nHEADS A/B // two heads\nSTART */* STOP a/b S/S and anything after the fifth column';
  const part: GridosPart = { limits, cases: [{ startPoints: { A: { x: 0, y: 0 }, B: { x: 1, y: 0 } }, data: 'QQ', expected: 'ab', validate: 'TEXT' }] };
  assert.equal(runGridos(program, part).allPassed, true);
});

test('parse errors are the site\'s own: duplicate rules, HEADS missing, an unknown start point', () => {
  assert.match(runGridos('HEADS A\nSTART Q STOP * S\nSTART Q STOP * S', line('Q', 'Q')).cases[0].error!, /Duplicate rule for state START and data Q/);
  assert.match(runGridos('START Q STOP * S', line('Q', 'Q')).cases[0].error!, /must start with HEADS/);
  assert.match(runGridos('HEADS C\nSTART Q STOP * S', line('Q', 'Q')).cases[0].error!, /starting position 'C' not found/);
});

test('two heads writing different values to one cell is an error', () => {
  const part: GridosPart = { limits, cases: [{ startPoints: { A: { x: 0, y: 0 }, B: { x: 0, y: 0 } }, data: 'Q', expected: 'Q', validate: 'TEXT' }] };
  assert.match(runGridos('HEADS AB\nSTART ** STOP xy SS', part).cases[0].error!, /Multiple heads trying to set the same cell/);
});

test('the step limit stops a program that never reaches STOP', () => {
  const result = runGridos('HEADS A\nSTART * START * S', { ...line('Q', 'Q'), limits: { ...limits, steps: 50 } });
  assert.equal(result.cases[0].error, '[ ERROR 507 ] You have reached the maximum number of steps: 50');
});

test("the part's validators (COUNT, REGEXP_ROW) decide when a case is neither EXACT nor TEXT", () => {
  const part: GridosPart = {
    limits: { ...limits, validators: [['COUNT', 'P', 2], ['REGEXP_ROW', '^P+$']] },
    cases: [{ startPoints: { A: { x: 0, y: 0 } }, data: 'PP', expected: '', validate: 'CUSTOM' }],
  };
  assert.equal(runGridos('HEADS A\nSTART * STOP * S', part).allPassed, true);
  assert.equal(runGridos('HEADS A\nSTART * STOP x S', part).allPassed, false);
});

test('golf counts the lines still longer than five characters once comments are cut — untrimmed, as on the site', () => {
  assert.equal(gridosGolf('HEADS A\n// a comment\n\nSTART * STOP * S // why\nab'), 2);
  assert.equal(gridosGolf('  ab  '), 1);
});
