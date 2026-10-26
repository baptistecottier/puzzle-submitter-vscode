import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runPythonSolver, SolverError } from '../src/core/pythonRunner';

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
  const { parts } = await runPythonSolver('python3', solution, { '2': '5' }, 'text', 2, path.dirname(solution), 60);
  assert.deepEqual(parts, ['5', '10']);
});

test('a generator-based solver is only consumed up to the requested part, so part 2 code never runs during a part 1 run (examples often only have a part 1 answer)', async () => {
  const solution = tmpFile(
    'day_07.py',
    'def solver(data):\n    yield len(data)\n    raise ValueError("part 2 not meant for this input")\n'
  );
  const { parts } = await runPythonSolver('python3', solution, { '1': 'abc' }, 'text', 1, path.dirname(solution), 60);
  assert.deepEqual(parts, ['3']);
  await assert.rejects(
    runPythonSolver('python3', solution, { '2': 'abc' }, 'text', 2, path.dirname(solution), 60),
    /part 2 not meant for this input/
  );
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

test('a crash is reported with a short summary, and the solution\'s own prints (lost before this ran unbuffered) are preserved in .detail', async () => {
  const solution = tmpFile(
    'day_14.py',
    "def solver(data):\n    print('before crash')\n    raise ValueError('bad input: ' + data)\n"
  );
  await assert.rejects(
    runPythonSolver('python3', solution, { '1': '42' }, 'text', 1, path.dirname(solution), 60),
    (error: unknown) => {
      assert.ok(error instanceof SolverError);
      assert.match(error.message, /^Solver failed: ValueError: bad input: 42$/);
      assert.match(error.detail ?? '', /before crash/);
      return true;
    }
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

test('prints before a timeout kill are preserved in .detail, not lost to Python\'s output buffering', async () => {
  const solution = tmpFile(
    'day_10.py',
    "import time\ndef solver(data):\n    print('print before hang')\n    time.sleep(30)\n    return 'never'\n"
  );
  await assert.rejects(
    runPythonSolver('python3', solution, { '1': 'x' }, 'text', 1, path.dirname(solution), 1),
    (error: unknown) => {
      assert.ok(error instanceof SolverError);
      assert.match(error.detail ?? '', /print before hang/);
      return true;
    }
  );
});

test('onSpawn hands back a kill() that ends the run early with a distinct "cancelled" message', async () => {
  const solution = tmpFile(
    'day_12.py',
    'import time\ndef solver(data):\n    time.sleep(30)\n    return "never"\n'
  );
  await assert.rejects(
    runPythonSolver('python3', solution, { '1': 'x' }, 'text', 1, path.dirname(solution), 60, (kill) => {
      setTimeout(kill, 50);
    }),
    /cancelled/
  );
});

test('killing a run that has already finished is a harmless no-op', async () => {
  const solution = tmpFile('day_13.py', 'def solver(data):\n    return "done"\n');
  let kill: (() => void) | undefined;
  const { parts } = await runPythonSolver('python3', solution, { '1': 'x' }, 'text', 1, path.dirname(solution), 60, (k) => {
    kill = k;
  });
  assert.deepEqual(parts, ['done']);
  assert.doesNotThrow(() => kill?.());
});

test('output captures the solution\'s own print() calls, with the result marker line stripped out', async () => {
  const solution = tmpFile(
    'day_10.py',
    'def solver(data):\n    print("debug:", data)\n    print("more debug")\n    return int(data) * 2\n'
  );
  const { parts, output } = await runPythonSolver('python3', solution, { '1': '21' }, 'text', 1, path.dirname(solution), 60);
  assert.deepEqual(parts, ['42']);
  assert.equal(output, 'debug: 21\nmore debug');
});

test('output is an empty string when the solution prints nothing', async () => {
  const solution = tmpFile('day_11.py', 'def solver(data):\n    return int(data)\n');
  const { output } = await runPythonSolver('python3', solution, { '1': '1' }, 'text', 1, path.dirname(solution), 60);
  assert.equal(output, '');
});

test('a solution using @dataclass at module level loads fine (needs the module registered in sys.modules before exec)', async () => {
  const solution = tmpFile(
    'quest_02.py',
    [
      'from dataclasses import dataclass',
      '',
      '@dataclass',
      'class Point:',
      '    x: int',
      '    y: int',
      '',
      'def solver(data):',
      '    p = Point(int(data), int(data))',
      '    return p.x + p.y',
      '',
    ].join('\n')
  );
  const { parts } = await runPythonSolver('python3', solution, { '1': '5' }, 'text', 1, path.dirname(solution), 60);
  assert.deepEqual(parts, ['10']);
});

const exampleSolution = (body: string) => tmpFile('day_14.py', body);
const runExample = (solution: string, input: string, example?: Record<string, unknown>) =>
  runPythonSolver('python3', solution, { '1': input }, 'text', 1, path.dirname(solution), 60, undefined, example);

test('an example run passes example=True to a solver that declares it — a real run never does', async () => {
  const solution = exampleSolution('def solver(data, example=False):\n    return "example" if example else "real"\n');
  assert.deepEqual((await runExample(solution, 'x', {})).parts, ['example']);
  assert.deepEqual((await runExample(solution, 'x')).parts, ['real']);
});

test("EXAMPLE_PARAMS overrides a solver's real-value defaults on example runs only, and wins over the example's extra", async () => {
  const solution = exampleSolution(
    'EXAMPLE_PARAMS = {"w": 11, "h": 7}\n\ndef solver(robots, w=101, h=103):\n    return f"{w}x{h}"\n'
  );
  assert.deepEqual((await runExample(solution, 'x', { w: 5, width: 3 })).parts, ['11x7']);
  assert.deepEqual((await runExample(solution, 'x')).parts, ['101x103']);
});

test("an example's extra values reach the parameters named like them; names a function doesn't declare are dropped", async () => {
  const solution = exampleSolution('def solver(data, width=101):\n    return width\n');
  assert.deepEqual((await runExample(solution, 'x', { width: 11, height: 7 })).parts, ['11']);
});

test('**kwargs receives every example parameter; preprocessing() gets them too', async () => {
  const solution = exampleSolution(
    'def preprocessing(data, example=False):\n    return (data, example)\n\ndef solver(data, flag, **params):\n    return f"{flag}:{sorted(params)}"\n'
  );
  assert.deepEqual((await runExample(solution, 'x', { steps: 10 })).parts, ["True:['example', 'steps']"]);
});

test("a parameter already filled positionally (tuple unpacking) isn't passed again by name", async () => {
  const solution = exampleSolution(
    'EXAMPLE_PARAMS = {"size": 7}\n\ndef preprocessing(data):\n    return (data, 70)\n\ndef solver(grid, size):\n    return size\n'
  );
  assert.deepEqual((await runExample(solution, 'x', {})).parts, ['70']);
});

const interactiveRun = (
  solution: string,
  onInput?: (prompt: string, newOutput: string) => Promise<string | undefined>,
  timeoutSeconds = 60
) => runPythonSolver('python3', solution, { '1': 'x' }, 'text', 1, path.dirname(solution), timeoutSeconds, undefined, undefined, onInput);

test("input() in a non-interactive run fails at once with a clear message, instead of hanging until the timeout", async () => {
  const solution = tmpFile('day_25.py', 'def solver(data):\n    return input("Command? ")\n');
  const started = Date.now();
  await assert.rejects(interactiveRun(solution, undefined, 30), /input\(\) isn't answered during Run All or Sync/);
  assert.ok(Date.now() - started < 5000);
});

test('input() in an interactive run is answered by onInput, with the prompt and what was printed since the last question', async () => {
  const solution = tmpFile(
    'day_25.py',
    'def solver(data):\n    print("You are in a room.")\n    a = input("Command? ")\n    print("You went " + a + ".")\n    b = input()\n    return a + "|" + b\n'
  );
  const asked: [string, string][] = [];
  const replies = ['north', 'take key'];
  const { parts, output } = await interactiveRun(solution, async (prompt, newOutput) => {
    asked.push([prompt, newOutput]);
    return replies.shift();
  });
  assert.deepEqual(parts, ['north|take key']);
  assert.deepEqual(asked, [
    ['Command? ', 'You are in a room.\n'],
    ['', 'You went north.\n'],
  ]);
  assert.equal(output, 'You are in a room.\nYou went north.');
});

test('answering an input() with undefined (Escape) cancels the run', async () => {
  const solution = tmpFile('day_25.py', 'def solver(data):\n    return input("Command? ")\n');
  await assert.rejects(interactiveRun(solution, async () => undefined), /cancelled/);
});

test("the timeout doesn't count the time spent waiting for an input() reply", async () => {
  const solution = tmpFile('day_25.py', 'def solver(data):\n    return input()\n');
  const { parts } = await interactiveRun(solution, () => new Promise((resolve) => setTimeout(() => resolve('late'), 1500)), 1);
  assert.deepEqual(parts, ['late']);
});
