import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PuzzleContext, PuzzleInputParts, PuzzleProvider, SolverInputShape } from '../types';

const MARKER = '__PUZZLE_SUBMITTER_RESULT__';
const INPUT_MARKER = '__PUZZLE_SUBMITTER_INPUT__';
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
// part at once as one dict argument {1: ..., 2: ..., 3: ...} (ec.py's run_solver), never
// unpacking regardless of what preprocessing() returns.
const BOOTSTRAP = `
import builtins, collections.abc, importlib.util, inspect, itertools, json, os, sys

solution_path, parts_path, shape, target_part, marker, example_json, input_marker = sys.argv[1:8]

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

if hasattr(module, "preprocessing"):
    data = call(module.preprocessing, [data])

if not hasattr(module, "solver"):
    raise SystemExit("No solver() function found in " + solution_path)

if shape == "text" and isinstance(data, tuple):
    result = call(module.solver, list(data))
else:
    result = call(module.solver, [data])

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
print(marker + json.dumps([str(p) for p in result_parts]))
`;

export interface PythonRunResult {
  parts: string[];
  /** Everything the solution printed (preprocessing()/solver()'s own print() calls),
   * with the result-marker line stripped out — callers that don't care (the normal
   * "fill in the answer" flow) can just ignore it. */
  output: string;
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
        // The solution's own prints, without the extension's question markers.
        const printed = stdout
          .split('\n')
          .filter((l) => !l.startsWith(INPUT_MARKER))
          .join('\n');
        if (cancelled) {
          reject(new SolverError('Solver run cancelled.', printed.trim() || undefined));
          return;
        }
        if (timedOut) {
          reject(
            new SolverError(
              `Solver timed out after ${timeoutSeconds}s (puzzleSubmitter.solverTimeoutSeconds) — killed.`,
              printed.trim() || undefined
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
          const detail = [printed.trim(), stderr.trim()].filter(Boolean).join('\n\n');
          reject(new SolverError(`Solver failed: ${summary}`, detail || undefined));
          return;
        }
        const lines = printed.split('\n');
        const markerIndex = lines.findIndex((l) => l.startsWith(MARKER));
        if (markerIndex === -1) {
          reject(new SolverError('Solver ran but printed no result.', (printed + stderr).trim() || undefined));
          return;
        }
        const output = lines.filter((_, i) => i !== markerIndex).join('\n').trim();
        try {
          const parts = JSON.parse(lines[markerIndex].slice(MARKER.length)) as string[];
          resolve({ parts, output });
        } catch {
          reject(new SolverError('Could not parse solver result.', lines[markerIndex]));
        }
      })
    );
    onSpawn?.(() => {
      cancelled = true;
      child.kill();
    });
  });
}
