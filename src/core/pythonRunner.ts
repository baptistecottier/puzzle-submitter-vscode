import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PuzzleContext, PuzzleInputParts, PuzzleProvider, SolverInputShape } from '../types';

const MARKER = '__PUZZLE_SUBMITTER_RESULT__';

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
// here, preprocessing()'s result is unpacked into solver(*args) when it's a tuple/list,
// exactly like aocp.py's solve_day() does. 'parts-dict' hands solver() every fetched
// part at once as one dict argument {1: ..., 2: ..., 3: ...} (ec.py's run_solver) —
// ec.py always calls solver(solver_input) with exactly one argument, even when
// preprocessing() returns a tuple/list, so 'parts-dict' never unpacks.
const BOOTSTRAP = `
import importlib.util, json, os, sys

solution_path, parts_path, shape, target_part, marker = sys.argv[1:6]

# so "from pythonfw.classes import X"-style imports from the workspace root resolve,
# the same way aocp.py adds the project root to sys.path before importing a day module.
sys.path.insert(0, os.getcwd())

spec = importlib.util.spec_from_file_location("puzzle_submitter_solution", solution_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with open(parts_path, encoding="utf-8") as f:
    parts = json.load(f)

if shape == "parts-dict":
    data = {int(k): v for k, v in parts.items()}
else:
    data = parts.get(target_part, next(iter(parts.values()), ""))

if hasattr(module, "preprocessing"):
    data = module.preprocessing(data)

if not hasattr(module, "solver"):
    raise SystemExit("No solver() function found in " + solution_path)

if shape == "text" and isinstance(data, (tuple, list)):
    result = module.solver(*data)
else:
    result = module.solver(data)

if isinstance(result, (str, bytes, dict)):
    result_parts = [result]
elif hasattr(result, "__iter__"):
    # Covers list/tuple and, importantly, generators — a solver() using "yield" for
    # part 1/part 2 returns an unconsumed generator object when called, matching how
    # aocp.py's own subprocess wrapper detects and materializes generator results.
    result_parts = list(result)
else:
    result_parts = [result]
print(marker + json.dumps([str(p) for p in result_parts]))
`;

export interface PythonRunResult {
  parts: string[];
}

/** Runs preprocessing()/solver() from a Python solution file against locally-cached input. */
export function runPythonSolver(
  pythonPath: string,
  solutionFile: string,
  inputParts: PuzzleInputParts,
  shape: SolverInputShape,
  targetPart: number,
  cwd: string
): Promise<PythonRunResult> {
  return new Promise((resolve, reject) => {
    const tag = `${Date.now()}-${process.pid}`;
    const bootstrapPath = path.join(os.tmpdir(), `puzzle-submitter-runner-${tag}.py`);
    const partsPath = path.join(os.tmpdir(), `puzzle-submitter-input-${tag}.json`);
    fs.writeFileSync(bootstrapPath, BOOTSTRAP, 'utf8');
    fs.writeFileSync(partsPath, JSON.stringify(inputParts), 'utf8');

    const cleanup = () => {
      fs.unlink(bootstrapPath, () => {});
      fs.unlink(partsPath, () => {});
    };

    cp.execFile(
      pythonPath,
      [bootstrapPath, solutionFile, partsPath, shape, String(targetPart), MARKER],
      { cwd, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        cleanup();
        if (error) {
          reject(new Error(`Solver failed (${pythonPath}): ${error.message}${stderr ? `\n${stderr.trim()}` : ''}`));
          return;
        }
        const line = stdout.split('\n').find((l) => l.startsWith(MARKER));
        if (!line) {
          reject(new Error(`Solver ran but printed no result.\n${(stdout + stderr).trim()}`));
          return;
        }
        try {
          const parts = JSON.parse(line.slice(MARKER.length)) as string[];
          resolve({ parts });
        } catch {
          reject(new Error(`Could not parse solver result: ${line}`));
        }
      }
    );
  });
}
