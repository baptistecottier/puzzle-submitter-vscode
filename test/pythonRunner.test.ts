import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runPythonSolver } from '../src/core/pythonRunner';

function tmpFile(name: string, contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'puzzle-submitter-test-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents, 'utf8');
  return file;
}

test("'text' shape: single-value solver, no preprocessing", async () => {
  const solution = tmpFile('day_01.py', 'def solver(data):\n    return len(data)\n');
  const { parts } = await runPythonSolver('python3', solution, { '1': 'hello world' }, 'text', 1, path.dirname(solution), 60);
  assert.deepEqual(parts, ['11']);
});

test("'text' shape: preprocessing feeds solver, matching this project's aocp.py convention", async () => {
  const solution = tmpFile(
    'day_02.py',
    'def preprocessing(data):\n    return data.strip()\n\ndef solver(data):\n    return data.upper()\n'
  );
  const { parts } = await runPythonSolver('python3', solution, { '1': '  hi  \n' }, 'text', 1, path.dirname(solution), 60);
  assert.deepEqual(parts, ['HI']);
});

test("'text' shape: picks the requested part's text out of the cached dict", async () => {
  const solution = tmpFile('day_03.py', 'def solver(data):\n    return data.upper()\n');
  const { parts } = await runPythonSolver(
    'python3',
    solution,
    { '1': 'part one', '2': 'part two' },
    'text',
    2,
    path.dirname(solution), 60
  );
  assert.deepEqual(parts, ['PART TWO']);
});

test("'text' shape: solver returning a tuple maps to multiple parts", async () => {
  const solution = tmpFile('day_04.py', 'def solver(data):\n    n = int(data)\n    return (n, n * 2)\n');
  const { parts } = await runPythonSolver('python3', solution, { '1': '21' }, 'text', 1, path.dirname(solution), 60);
  assert.deepEqual(parts, ['21', '42']);
});

test("'text' shape: preprocessing returning a tuple is unpacked into solver(*args)", async () => {
  const solution = tmpFile(
    'day_05.py',
    'def preprocessing(data):\n    return (data.strip(), len(data.strip()))\n\ndef solver(text, n):\n    return f"{text}:{n}"\n'
  );
  const { parts } = await runPythonSolver('python3', solution, { '1': 'abc\n' }, 'text', 1, path.dirname(solution), 60);
  assert.deepEqual(parts, ['abc:3']);
});

test("'text' shape: preprocessing returning a LIST is NOT unpacked, only a tuple is (matching aocp.py's isinstance(puzzle_input, tuple) check exactly — bug seen in a real day_03.py whose preprocessing() returns one (dx, dy) tuple per input character)", async () => {
  const solution = tmpFile(
    'day_03.py',
    'def preprocessing(data):\n    return [(1, 1) for _ in data]\n\ndef solver(directions):\n    return len(directions)\n'
  );
  const { parts } = await runPythonSolver(
    'python3',
    solution,
    { '1': '^'.repeat(8192) },
    'text',
    1,
    path.dirname(solution), 60
  );
  // solver(directions) got the 8192-element list as ONE argument, not solver(*directions)
  // as 8192 — so len(directions) is 8192, not a "takes 1 positional argument but 8192
  // were given" TypeError.
  assert.deepEqual(parts, ['8192']);
});

test("'parts-dict' shape: solver receives every cached part at once, matching ec.py's run_solver", async () => {
  const solution = tmpFile(
    'quest_01.py',
    'def solver(data):\n    return [data[1].upper(), data[2].upper(), data[3].upper()]\n'
  );
  const { parts } = await runPythonSolver(
    'python3',
    solution,
    { '1': 'one', '2': 'two', '3': 'three' },
    'parts-dict',
    2,
    path.dirname(solution), 60
  );
  assert.deepEqual(parts, ['ONE', 'TWO', 'THREE']);
});

test("'parts-dict' shape: preprocessing also receives the whole dict", async () => {
  const solution = tmpFile(
    'quest_02.py',
    'def preprocessing(data):\n    return {k: v.strip() for k, v in data.items()}\n\ndef solver(data):\n    return len(data)\n'
  );
  const { parts } = await runPythonSolver(
    'python3',
    solution,
    { '1': ' a ', '2': ' b ' },
    'parts-dict',
    1,
    path.dirname(solution), 60
  );
  assert.deepEqual(parts, ['2']);
});

test("'parts-dict' shape: preprocessing returning a list is NOT unpacked (unlike 'text' — bug seen in a real story quest)", async () => {
  const solution = tmpFile(
    'quest_03.py',
    'def preprocessing(data):\n    return [data[1], data[2], data[3]]\n\ndef solver(data):\n    return len(data)\n'
  );
  const { parts } = await runPythonSolver(
    'python3',
    solution,
    { '1': 'a', '2': 'b', '3': 'c' },
    'parts-dict',
    1,
    path.dirname(solution), 60
  );
  // solver(data) got the 3-element list as ONE argument, not solver(*data) as 3 — so
  // len(data) is 3, not a "takes 1 positional argument but 3 were given" TypeError.
  assert.deepEqual(parts, ['3']);
});

test("a generator-based solver (yield) is consumed into real values, not '<generator object ...>'", async () => {
  const solution = tmpFile(
    'day_07.py',
    'def solver(data):\n    n = int(data)\n    yield n\n    yield n * 2\n'
  );
  const { parts } = await runPythonSolver('python3', solution, { '1': '5' }, 'text', 1, path.dirname(solution), 60);
  assert.deepEqual(parts, ['5', '10']);
});

test('a plain string result is kept as one part, not split into characters', async () => {
  const solution = tmpFile('day_08.py', 'def solver(data):\n    return "hello"\n');
  const { parts } = await runPythonSolver('python3', solution, { '1': 'x' }, 'text', 1, path.dirname(solution), 60);
  assert.deepEqual(parts, ['hello']);
});

test('missing solver() surfaces a clear error instead of a cryptic traceback', async () => {
  const solution = tmpFile('day_06.py', 'def preprocessing(data):\n    return data\n');
  await assert.rejects(
    runPythonSolver('python3', solution, { '1': 'x' }, 'text', 1, path.dirname(solution), 60),
    /No solver/
  );
});

test('a solver that runs longer than solverTimeoutSeconds is killed with a clear message, not a hang', async () => {
  const solution = tmpFile(
    'day_09.py',
    'import time\ndef solver(data):\n    time.sleep(30)\n    return "never"\n'
  );
  await assert.rejects(
    runPythonSolver('python3', solution, { '1': 'x' }, 'text', 1, path.dirname(solution), 1),
    /timed out after 1s/
  );
});
