import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  expectedAnswer,
  mergeExamples,
  needsExampleFetch,
  readExamples,
  runExamples,
  sameExamples,
  siteExamplesPath,
  writeExamples,
} from '../src/core/examples';
import { PuzzleContext } from '../src/types';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'puzzle-submitter-examples-'));
}

function tmpFolder(): import('vscode').WorkspaceFolder {
  return { uri: { fsPath: tmpDir() } } as import('vscode').WorkspaceFolder;
}

const ctx = (group: string, index: string): PuzzleContext => ({ group, index, part: 1 });

test("examples are cached per site under .puzzle-submitter/, one entry per puzzle, in aocd's Example shape", () => {
  const folder = tmpFolder();
  const entry = { parts: 2, examples: [{ input_data: '2x3x4', answer_a: '58', answer_b: '34' }, { input_data: 'x', answer_a: '1', extra: { wire: 'd' } }] };
  writeExamples(folder, 'aoc', ctx('2015', '2'), entry);
  writeExamples(folder, 'aoc', ctx('2015', '7'), { parts: 1, examples: [] });
  assert.deepEqual(readExamples(folder, 'aoc', ctx('2015', '2')), entry);
  assert.deepEqual(readExamples(folder, 'aoc', ctx('2015', '7')), { parts: 1, examples: [] });
  assert.equal(readExamples(folder, 'aoc', ctx('2015', '3')), undefined);
  assert.ok(fs.existsSync(path.join(folder.uri.fsPath, siteExamplesPath('aoc'))));
  assert.equal(siteExamplesPath('everybodycodes'), '.puzzle-submitter/everybodycodes-examples.json');
});

test('a hand-written entry may be just the examples list; a missing or corrupt file reads as nothing cached', () => {
  const folder = tmpFolder();
  const file = path.join(folder.uri.fsPath, siteExamplesPath('codyssi'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ '2025': { '1': [{ input_data: 'abc', answer_a: '3' }, { nope: true }] } }));
  assert.deepEqual(readExamples(folder, 'codyssi', ctx('2025', '1')), { parts: 0, examples: [{ input_data: 'abc', answer_a: '3' }] });
  fs.writeFileSync(file, 'not json');
  assert.equal(readExamples(folder, 'codyssi', ctx('2025', '1')), undefined);
});

test('a fetch is due when nothing is cached, or when more parts are visible now than when cached', () => {
  assert.equal(needsExampleFetch(undefined, 1), true);
  assert.equal(needsExampleFetch({ parts: 1, examples: [] }, 1), false); // fetched, no examples: not again
  assert.equal(needsExampleFetch({ parts: 1, examples: [] }, 2), true);
  assert.equal(needsExampleFetch({ parts: 2, examples: [] }, 2), false);
});

test("merging keeps cached examples as they are (hand fixes survive) and adds only newly visible parts' answers", () => {
  const cached = { parts: 1, examples: [{ input_data: 'abc', answer_a: 'fixed by hand' }] };
  const fetched = {
    parts: 2,
    examples: [
      { input_data: 'abc', answer_a: 'site value', answer_b: '7' }, // same input: gains answer_b only
      { input_data: 'xyz', answer_b: '9', extra: { n: 2 } }, // new part 2 example
      { input_data: 'old', answer_a: '1' }, // part 1 was already seen: not re-added
    ],
  };
  assert.deepEqual(mergeExamples(cached, fetched), {
    parts: 2,
    examples: [
      { input_data: 'abc', answer_a: 'fixed by hand', answer_b: '7' },
      { input_data: 'xyz', answer_b: '9', extra: { n: 2 } },
    ],
  });
  assert.deepEqual(mergeExamples(undefined, fetched), fetched);
});

test('comparing examples ignores the order of their fields', () => {
  assert.equal(sameExamples([{ input_data: 'a', answer_b: '2', answer_a: '1' }], [{ answer_a: '1', input_data: 'a', answer_b: '2' }]), true);
  assert.equal(sameExamples([{ input_data: 'a', answer_a: '1' }], [{ input_data: 'a', answer_a: '2' }]), false);
});

test('expected answers are per part, and numbers from hand-written files become text', () => {
  const example = { input_data: '', answer_a: 58 as unknown as string, answer_c: 'x' };
  assert.equal(expectedAnswer(example, 1), '58');
  assert.equal(expectedAnswer(example, 2), undefined);
  assert.equal(expectedAnswer(example, 3), 'x');
});

test('runExamples checks each example that has an answer for the part, and keeps going past a crash', async () => {
  const dir = tmpDir();
  const solution = path.join(dir, 'day_02.py');
  fs.writeFileSync(solution, 'def solver(data):\n    if data == "boom":\n        raise ValueError("bad input")\n    return len(data)\n');
  const runs = await runExamples(
    'python3',
    solution,
    'text',
    [
      { input_data: 'abc', answer_a: '3' },
      { input_data: 'abcd', answer_b: '4' }, // no part 1 answer: skipped
      { input_data: 'boom', answer_a: '1' },
      { input_data: 'ab', answer_a: '5', extra: { steps: 6 } },
    ],
    1,
    dir,
    60
  );
  assert.deepEqual(
    runs.map((r) => [r.index, r.status]),
    [
      [1, 'pass'],
      [3, 'error'],
      [4, 'fail'],
    ]
  );
  const error = runs[1];
  assert.ok(error.status === 'error' && /ValueError: bad input/.test(error.message));
  assert.deepEqual(runs[2], { index: 4, expected: '5', extra: { steps: 6 }, status: 'fail', computed: '2', output: '' });
});

test('cancelling stops the remaining examples instead of moving on to the next one', async () => {
  const dir = tmpDir();
  const solution = path.join(dir, 'day_03.py');
  fs.writeFileSync(solution, 'import time\ndef solver(data):\n    time.sleep(30)\n    return 0\n');
  let spawned = 0;
  await assert.rejects(
    runExamples(
      'python3',
      solution,
      'text',
      [
        { input_data: 'a', answer_a: '0' },
        { input_data: 'b', answer_a: '0' },
      ],
      1,
      dir,
      60,
      (kill) => {
        spawned++;
        setTimeout(kill, 100);
      }
    ),
    /cancelled/
  );
  assert.equal(spawned, 1);
});

test("'parts-dict' (Everybody Codes): a part 2 example runs as {1: a part 1 example, 2: this one}, like a real run", async () => {
  const dir = tmpDir();
  const solution = path.join(dir, 'quest_01.py');
  // Reads parts by position, the way real Everybody Codes solutions do.
  fs.writeFileSync(solution, 'def preprocessing(data):\n    return list(data.values())\n\ndef solver(notes):\n    yield len(notes[0])\n    yield notes[0] + "+" + notes[1]\n');
  const runs = await runExamples(
    'python3',
    solution,
    'parts-dict',
    [
      { input_data: 'abc', answer_a: '3' },
      { input_data: 'xy', answer_b: 'abc+xy' },
    ],
    2,
    dir,
    60
  );
  assert.deepEqual(runs.map((r) => [r.index, r.status]), [[2, 'pass']]);
});

test("'parts-dict': with no example for an earlier part to stand in, the run is an error saying so", async () => {
  const dir = tmpDir();
  const solution = path.join(dir, 'quest_02.py');
  fs.writeFileSync(solution, 'def solver(data):\n    yield 1\n    yield 2\n');
  const runs = await runExamples('python3', solution, 'parts-dict', [{ input_data: 'xy', answer_b: '2' }], 2, dir, 60);
  assert.equal(runs[0].status, 'error');
  assert.ok(runs[0].status === 'error' && /example for each earlier part/.test(runs[0].message));
});
