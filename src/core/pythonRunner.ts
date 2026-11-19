import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PuzzleContext, PuzzleInputParts, PuzzleProvider, SolverInputShape } from '../types';

const MARKER = '__PUZZLE_SUBMITTER_RESULT__';
const INPUT_MARKER = '__PUZZLE_SUBMITTER_INPUT__';
const TIME_MARKER = '__PUZZLE_SUBMITTER_SECONDS__';
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

/** Whether "Run solver()" applies to this file/context: the provider declares a calling
 * shape, the file is Python, and (for providers where it varies per puzzle, e.g. Everybody
 * Codes' GridOS) the provider itself confirms this specific context supports it. */
export function canRunSolver(provider: PuzzleProvider, ctx: PuzzleContext | undefined, filePath: string): boolean {
  if (!provider.solverInputShape || !filePath.endsWith('.py')) return false;
  if (!ctx) return true;
  return provider.supportsRunner ? provider.supportsRunner(ctx) : true;
}

// Mirrors this project's own preprocessing(data)/solver(data) convention
// (pythonfw/aocp.py, everybodycodes/scripts/ec.py, codyssi.py, ...). Two calling shapes:
// 'text' hands solver() the single relevant part's raw string (aocp.py's convention) —
// here, preprocessing()'s result is unpacked into solver(*args) only when it's
// specifically a tuple (not a list), exactly matching aocp.py's own
// isinstance(puzzle_input, builtins.tuple) check. Conflating tuple and list here (an
// earlier version of this file did) broke a real day_03.py whose preprocessing() returns
// a per-character list of (dx, dy) tuples meant to be consumed as one structure, not
// splatted into thousands of positional args. 'parts-dict' hands solver() every fetched
// part at once as one dict argument {1: ..., 2: ..., 3: ...} (ec.py's run_solver). On any
// shape, solver() also says so itself: a tuple or list goes to solver(*args) when it
// declares two or more required arguments, and a tuple when it takes *args (see spread).
const BOOTSTRAP = `
import builtins, collections.abc, importlib.util, inspect, itertools, json, os, sys

solution_path, parts_path, shape, target_part, marker, example_json, input_marker, time_marker = sys.argv[1:9]

# input() is answered by the extension (an input box) on interactive runs: the question
# goes out as a marker line, the reply comes back on stdin. The bulk runs (Run All, Sync)
# don't stop to ask on every puzzle, so there it fails at once with a clear message
# instead of blocking until the timeout.
def _input(prompt=""):
    if not input_marker:
        raise RuntimeError(
            "input() isn't answered during Run All or Sync, which don't stop to ask on every"
            " puzzle - run this one from the panel to answer it"
        )
    sys.stdout.write(input_marker + json.dumps(str(prompt)) + "\\n")
    sys.stdout.flush()
    line = sys.stdin.readline()
    if not line:
        raise EOFError("input() got no answer")
    return line.rstrip("\\r\\n")

builtins.input = _input

# so "from pythonfw.classes import X"-style imports from the workspace root resolve,
# the same way aocp.py adds the project root to sys.path before importing a day module.
sys.path.insert(0, os.getcwd())

spec = importlib.util.spec_from_file_location("puzzle_submitter_solution", solution_path)
module = importlib.util.module_from_spec(spec)
# Must be registered in sys.modules before exec_module — @dataclass (and anything else
# that resolves type hints via sys.modules[cls.__module__]) fails with
# "AttributeError: 'NoneType' object has no attribute '__dict__'" without this, since
# module_from_spec() alone never adds the module there.
sys.modules[spec.name] = module
spec.loader.exec_module(module)

with open(parts_path, encoding="utf-8") as f:
    parts = json.load(f)

# Only when running an example: keyword arguments for preprocessing()/solver(), so they
# can switch to the example's parameters (a smaller grid, fewer steps) — example=True,
# then the example's own extra values, then the solution's EXAMPLE_PARAMS dict, which
# wins. Each function is given only the names it declares (all of them with **kwargs),
# never one it's already getting positionally. Real runs pass none of this.
example_params = {}
if example_json:
    example_params = {"example": True, **json.loads(example_json)}
    own = getattr(module, "EXAMPLE_PARAMS", None)
    if isinstance(own, dict):
        example_params.update(own)

def call(func, args):
    if not example_params:
        return func(*args)
    try:
        params = list(inspect.signature(func).parameters.values())
    except (TypeError, ValueError):
        return func(*args)
    positional = [p.name for p in params if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)]
    filled = set(positional[:len(args)])
    if any(p.kind is p.VAR_KEYWORD for p in params):
        accepted = set(example_params)
    else:
        accepted = {p.name for p in params if p.kind in (p.POSITIONAL_OR_KEYWORD, p.KEYWORD_ONLY)}
    return func(*args, **{k: v for k, v in example_params.items() if k in accepted - filled})

if shape == "parts-dict":
    data = {int(k): v for k, v in parts.items()}
else:
    data = parts.get(target_part, next(iter(parts.values()), ""))

if not hasattr(module, "solver"):
    raise SystemExit("No solver() function found in " + solution_path)

# Timed from here to the last answer: preprocessing() and solver() only, never the
# interpreter start-up, the imports or this wrapper (what a benchmark is meant to measure).
import time
started = time.perf_counter()

if hasattr(module, "preprocessing"):
    data = call(module.preprocessing, [data])

# What solver() is called with, as a list of positional arguments. One-argument solvers
# keep getting a list (or, on 'parts-dict', a tuple) whole. Parameters an example run fills
# by name don't count as required.
def spread(func, value):
    if shape == "text" and isinstance(value, tuple):
        return list(value)
    if not isinstance(value, (tuple, list)):
        return [value]
    try:
        params = inspect.signature(func).parameters.values()
    except (TypeError, ValueError):
        return [value]
    required = [
        p for p in params
        if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)
        and p.default is p.empty
        and p.name not in example_params
    ]
    takes_rest = any(p.kind is p.VAR_POSITIONAL for p in params)
    if len(required) >= 2 or (takes_rest and isinstance(value, tuple)):
        return list(value)
    return [value]

result = call(module.solver, spread(module.solver, data))

if isinstance(result, (str, bytes, dict)):
    result_parts = [result]
elif isinstance(result, collections.abc.Iterator):
    # Generators — a solver() using "yield" for part 1/part 2 returns an unconsumed
    # generator object when called, matching how aocp.py's own subprocess wrapper
    # detects and materializes generator results. Only consumed up to the requested
    # part, so part 2's code never runs (and can't crash or hang) during a part 1 run —
    # which matters for examples, many of which only come with a part 1 answer.
    result_parts = list(itertools.islice(result, int(target_part)))
elif hasattr(result, "__iter__"):
    result_parts = list(result)
else:
    result_parts = [result]
elapsed = time.perf_counter() - started
print(time_marker + repr(elapsed))
print(marker + json.dumps([str(p) for p in result_parts]))
`;

export interface PythonRunResult {
  parts: string[];
  /** Everything the solution printed (preprocessing()/solver()'s own print() calls),
   * with the result-marker line stripped out — callers that don't care (the normal
   * "fill in the answer" flow) can just ignore it. */
  output: string;
  /** Seconds spent in preprocessing() and solver() — not start-up or imports. */
  seconds?: number;
}

/** Thrown for any run failure. `message` is a short, one-line summary fit for a VS Code
 * notification; `detail`, if present, is the fuller picture (the solution's own prints,
 * a full traceback) that belongs in the output channel instead of a toast — see
 * showSolverError in ./output. */
export class SolverError extends Error {
  constructor(message: string, public readonly detail?: string) {
    super(message);
    this.name = 'SolverError';
  }
}

/** The last non-empty line of a Python traceback is the actual exception
 * ("ValueError: ...") — a far more useful one-line summary than the whole traceback. */
function lastLine(text: string): string | undefined {
  const lines = text.trim().split('\n').filter(Boolean);
  return lines.length ? lines[lines.length - 1] : undefined;
}

/** Runs preprocessing()/solver() from a Python solution file against locally-cached input.
 * Killed after timeoutSeconds if it hasn't finished — see puzzleSubmitter.solverTimeoutSeconds,
 * which callers resolve and pass in (this file stays vscode-free so it's plain-Node testable).
 * `onSpawn`, if given, is called synchronously with a `kill()` function once the process
 * exists — lets a caller (a Cancel button, a cancellation token) end the run early, distinct
 * from the timeout's own kill (see the "cancelled" vs "timed out" messages below).
 * `example`, if given, marks this as an example run: the example's extra values (often
 * none), passed on with example=True and the solution's EXAMPLE_PARAMS — see BOOTSTRAP.
 * `onInput`, if given, makes the run interactive: each input() the solution calls is
 * handed to it with the prompt and what was printed since the last one, and its reply is
 * what input() returns (undefined cancels the run). The timeout doesn't count the time
 * spent waiting for a reply. Without it (Run All, Sync), input() fails immediately. */
export function runPythonSolver(
  pythonPath: string,
  solutionFile: string,
  inputParts: PuzzleInputParts,
  shape: SolverInputShape,
  targetPart: number,
  cwd: string,
  timeoutSeconds: number,
  onSpawn?: (kill: () => void) => void,
  example?: Record<string, unknown>,
  onInput?: (prompt: string, newOutput: string) => Promise<string | undefined>
): Promise<PythonRunResult> {
  return new Promise((resolve, reject) => {
    const tag = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    const bootstrapPath = path.join(os.tmpdir(), `puzzle-submitter-runner-${tag}.py`);
    const partsPath = path.join(os.tmpdir(), `puzzle-submitter-input-${tag}.json`);
    fs.writeFileSync(bootstrapPath, BOOTSTRAP, 'utf8');
    fs.writeFileSync(partsPath, JSON.stringify(inputParts), 'utf8');

    const child = cp.spawn(
      pythonPath,
      // -u: unbuffered stdout/stderr. Without it, a killed (timeout/cancel) or crashed
      // process can lose its own print() output to Python's block-buffering — it's only
      // flushed on a normal exit, which neither of those is. It's also what lets an
      // input() question reach onInput while the solution waits for the reply.
      [
        '-u',
        bootstrapPath,
        solutionFile,
        partsPath,
        shape,
        String(targetPart),
        MARKER,
        example ? JSON.stringify(example) : '',
        onInput ? INPUT_MARKER : '',
        TIME_MARKER,
      ],
      { cwd }
    );
    child.stdin.on('error', () => {}); // a reply written after the process has exited
    if (!onInput) child.stdin.end(); // a direct sys.stdin read gets EOF, not a wait forever

    let stdout = '';
    let stderr = '';
    let cancelled = false;
    let timedOut = false;
    let tooMuchOutput = false;
    let settled = false;

    // The timeout, paused while an input() waits for its reply.
    let remainingMs = timeoutSeconds * 1000;
    let startedAt = 0;
    let timer: NodeJS.Timeout | undefined;
    const startTimer = () => {
      startedAt = Date.now();
      timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, remainingMs);
    };
    const pauseTimer = () => {
      clearTimeout(timer);
      remainingMs -= Date.now() - startedAt;
    };
    startTimer();

    let unscanned = ''; // stdout not yet split into lines, looking for input() questions
    let handedOver = 0; // how much of stdout onInput has already been given
    const ask = async (line: string, lineEnd: number) => {
      pauseTimer();
      let prompt = '';
      try {
        prompt = String(JSON.parse(line.slice(INPUT_MARKER.length)));
      } catch {
        // malformed marker — ask with no prompt
      }
      const newOutput = stdout.slice(handedOver, lineEnd - line.length - 1);
      handedOver = lineEnd;
      const reply = await onInput!(prompt, newOutput);
      if (settled) return;
      if (reply === undefined) {
        cancelled = true;
        child.kill();
        return;
      }
      child.stdin.write(reply + '\n');
      startTimer();
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      const scannedUpTo = stdout.length - unscanned.length;
      stdout += chunk;
      if (stdout.length + stderr.length > MAX_OUTPUT_BYTES) {
        tooMuchOutput = true;
        child.kill();
        return;
      }
      if (!onInput) return;
      unscanned += chunk;
      let offset = scannedUpTo;
      let newline: number;
      while ((newline = unscanned.indexOf('\n')) !== -1) {
        const line = unscanned.slice(0, newline);
        unscanned = unscanned.slice(newline + 1);
        offset += newline + 1;
        if (line.startsWith(INPUT_MARKER)) void ask(line, offset);
      }
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fs.unlink(bootstrapPath, () => {});
      fs.unlink(partsPath, () => {});
      settle();
    };
    child.on('error', (error) => finish(() => reject(new SolverError(`Solver failed: ${error.message}`))));
    child.on('close', (code) =>
      finish(() => {
        // The solution's own prints, without the extension's question markers — otherwise
        // exactly as printed: leading spaces and blank lines can be part of a drawn grid.
        const withTiming = stdout
          .split('\n')
          .filter((l) => !l.startsWith(INPUT_MARKER))
          .join('\n');
        // The timing line sits right before the result line. Cut out as a unit, a final
        // print(..., end='') glued to it stays glued to the result line, as before.
        const timing = new RegExp(`${TIME_MARKER}([^\\n]*)\\n?`).exec(withTiming);
        const seconds = timing ? Number.parseFloat(timing[1]) : undefined;
        const printed = timing ? withTiming.replace(timing[0], '') : withTiming;
        const asPrinted = (text: string) => (text.trim() ? text.replace(/\r?\n$/, '') : undefined);
        if (cancelled) {
          reject(new SolverError('Solver run cancelled.', asPrinted(printed)));
          return;
        }
        if (timedOut) {
          reject(
            new SolverError(
              `Solver timed out after ${timeoutSeconds}s (puzzleSubmitter.solverTimeoutSeconds) — killed.`,
              asPrinted(printed)
            )
          );
          return;
        }
        if (tooMuchOutput) {
          reject(new SolverError('Solver printed more than 10 MB — killed.'));
          return;
        }
        if (code !== 0) {
          const summary = lastLine(stderr) ?? `exited with code ${code}`;
          const detail = [asPrinted(printed), asPrinted(stderr)].filter(Boolean).join('\n\n');
          reject(new SolverError(`Solver failed: ${summary}`, detail || undefined));
          return;
        }
        // The result line comes last, but not necessarily at the start of a line: a final
        // print(..., end='') leaves it glued to that print, which stays in the output.
        const start = printed.lastIndexOf(MARKER);
        if (start === -1) {
          reject(new SolverError('Solver ran but printed no result.', asPrinted(printed + stderr)));
          return;
        }
        const lineEnd = printed.indexOf('\n', start);
        const resultLine = printed.slice(start + MARKER.length, lineEnd === -1 ? undefined : lineEnd);
        const output = asPrinted(printed.slice(0, start) + (lineEnd === -1 ? '' : printed.slice(lineEnd + 1))) ?? '';
        try {
          const parts = JSON.parse(resultLine) as string[];
          resolve({ parts, output, seconds });
        } catch {
          reject(new SolverError('Could not parse solver result.', MARKER + resultLine));
        }
      })
    );
    onSpawn?.(() => {
      cancelled = true;
      child.kill();
    });
  });
}
