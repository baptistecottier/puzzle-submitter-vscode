import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { FetchedExamples, PuzzleContext, PuzzleExample, PuzzleInputParts, PuzzleProvider, SiteId, SolverInputShape } from '../types';
import { runPythonSolver } from './pythonRunner';

export type ExampleRun = { index: number; expected: string; extra?: Record<string, unknown> } & (
  | { status: 'pass' | 'fail'; computed: string; output: string }
  | { status: 'error'; message: string; detail?: string }
);

/** One puzzle's examples as cached: `parts` is how many parts' text the site showed when
 * they were fetched (later parts unlock as earlier ones are solved), so it can tell when
 * fetching again would find more — and a puzzle with no examples isn't fetched again for
 * nothing. 0 for examples written by hand. */
export interface CachedExamples {
  parts: number;
  examples: PuzzleExample[];
}

/** One JSON file per site, beside the input cache (see ./localInput):
 * { "<group>": { "<index>": { "parts": 2, "examples": [...] } } }. Hand-editable — an
 * entry may also be just the examples list. */
type SiteExampleStore = Record<string, Record<string, unknown>>;

/** Workspace-relative path to a site's examples cache. */
export function siteExamplesPath(siteId: SiteId): string {
  return `.puzzle-submitter/${siteId}-examples.json`;
}

function absoluteSiteExamplesPath(folder: vscode.WorkspaceFolder, siteId: SiteId): string {
  return path.join(folder.uri.fsPath, siteExamplesPath(siteId));
}

function readStore(folder: vscode.WorkspaceFolder, siteId: SiteId): SiteExampleStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(absoluteSiteExamplesPath(folder, siteId), 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as SiteExampleStore;
  } catch {
    // missing or corrupt — treat as empty rather than crashing the extension
  }
  return {};
}

function validExamples(value: unknown): PuzzleExample[] {
  if (!Array.isArray(value)) return [];
  return value.filter((e): e is PuzzleExample => Boolean(e) && typeof e === 'object' && typeof e.input_data === 'string');
}

/** Whatever's cached for this puzzle, if anything. */
export function readExamples(folder: vscode.WorkspaceFolder, siteId: SiteId, ctx: PuzzleContext): CachedExamples | undefined {
  const entry = readStore(folder, siteId)[ctx.group]?.[ctx.index];
  if (Array.isArray(entry)) return { parts: 0, examples: validExamples(entry) };
  if (!entry || typeof entry !== 'object') return undefined;
  const { parts, examples } = entry as { parts?: unknown; examples?: unknown };
  return { parts: typeof parts === 'number' ? parts : 0, examples: validExamples(examples) };
}

/** Replaces this puzzle's entry — never touches other puzzles in the site's file. */
export function writeExamples(folder: vscode.WorkspaceFolder, siteId: SiteId, ctx: PuzzleContext, entry: CachedExamples): void {
  const store = readStore(folder, siteId);
  store[ctx.group] = store[ctx.group] ?? {};
  store[ctx.group][ctx.index] = entry;
  const file = absoluteSiteExamplesPath(folder, siteId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2), 'utf8');
}

/** Whether fetching could find examples the cache doesn't have yet: nothing cached, or
 * fewer parts seen back then than `visibleParts` now. */
export function needsExampleFetch(cached: CachedExamples | undefined, visibleParts: number): boolean {
  return !cached || cached.parts < visibleParts;
}

/** Fetches what the site shows now and merges it into the cache (see mergeExamples). */
export async function fetchAndCacheExamples(
  provider: PuzzleProvider,
  ctx: PuzzleContext,
  folder: vscode.WorkspaceFolder,
  token: string,
  contact: string
): Promise<CachedExamples> {
  if (!provider.fetchExamples) throw new Error(`${provider.label} has no way to fetch examples.`);
  const entry = mergeExamples(readExamples(folder, provider.id, ctx), await provider.fetchExamples(ctx, token, contact));
  writeExamples(folder, provider.id, ctx, entry);
  return entry;
}

/** Same examples, ignoring the order of each example's fields. */
export function sameExamples(a: PuzzleExample[], b: PuzzleExample[]): boolean {
  const canonical = (examples: PuzzleExample[]) =>
    JSON.stringify(examples.map((e) => Object.fromEntries(Object.entries(e).sort(([x], [y]) => x.localeCompare(y)))));
  return canonical(a) === canonical(b);
}

const ANSWER_KEYS = ['answer_a', 'answer_b', 'answer_c'] as const;

/** Adds what a fetch found for parts the cache hadn't seen yet, leaving everything already
 * cached as it is — so examples fixed by hand survive a later part unlocking. A newly
 * seen part's answer joins the cached example with the same input (Advent of Code's
 * examples usually serve both parts), or comes in as an example of its own. */
export function mergeExamples(cached: CachedExamples | undefined, fetched: FetchedExamples): CachedExamples {
  if (!cached) return { parts: fetched.parts, examples: fetched.examples };
  const examples = cached.examples.map((e) => ({ ...e }));
  for (const found of fetched.examples) {
    const newKeys = ANSWER_KEYS.filter((key, i) => i + 1 > cached.parts && found[key] !== undefined);
    if (!newKeys.length) continue;
    const same = examples.find((e) => e.input_data === found.input_data);
    const target: PuzzleExample = same ?? { input_data: found.input_data };
    for (const key of newKeys) if (target[key] === undefined) target[key] = found[key];
    if (!same) {
      if (found.extra) target.extra = found.extra;
      examples.push(target);
    }
  }
  return { parts: Math.max(cached.parts, fetched.parts), examples };
}

/** Hand-written files sometimes use numbers (`"answer_a": 58`), so this normalizes to text. */
export function expectedAnswer(example: PuzzleExample, part: number): string | undefined {
  const value = part === 1 ? example.answer_a : part === 2 ? example.answer_b : part === 3 ? example.answer_c : undefined;
  return value === undefined || value === null ? undefined : String(value);
}

/** What solver() is handed for one example. A 'text' solver only ever sees the one
 * input. A 'parts-dict' solver (Everybody Codes) gets every part at once and typically
 * reads them by position, so a part 2 example is run as {1: a part 1 example, 2: this
 * one} — the way a real run passes every part up to the one asked for. Undefined when
 * an earlier part has no example to stand in for it. */
function exampleInput(
  examples: PuzzleExample[],
  example: PuzzleExample,
  part: number,
  shape: SolverInputShape
): PuzzleInputParts | undefined {
  if (shape === 'text') return { [String(part)]: example.input_data };
  const inputs: PuzzleInputParts = {};
  for (let earlier = 1; earlier < part; earlier++) {
    const standIn = examples.find((e) => expectedAnswer(e, earlier) !== undefined);
    if (!standIn) return undefined;
    inputs[String(earlier)] = standIn.input_data;
  }
  inputs[String(part)] = example.input_data;
  return inputs;
}

/** Runs solver() once per example that has an expected answer for `part`, comparing
 * against it. A crash or timeout on one example is recorded as that example's result and
 * the rest still run; a cancellation (see runPythonSolver's onSpawn) stops them all. */
export async function runExamples(
  pythonPath: string,
  solutionFile: string,
  shape: SolverInputShape,
  examples: PuzzleExample[],
  part: number,
  cwd: string,
  timeoutSeconds: number,
  onSpawn?: (kill: () => void) => void,
  onInput?: (prompt: string, newOutput: string) => Promise<string | undefined>
): Promise<ExampleRun[]> {
  const runs: ExampleRun[] = [];
  for (const [i, example] of examples.entries()) {
    const expected = expectedAnswer(example, part);
    if (expected === undefined) continue;
    const base = { index: i + 1, expected, ...(example.extra ? { extra: example.extra } : {}) };
    const inputs = exampleInput(examples, example, part, shape);
    if (!inputs) {
      const message = `solver() gets every part at once, so this needs an example for each earlier part too.`;
      runs.push({ ...base, status: 'error', message });
      continue;
    }
    try {
      const { parts, output } = await runPythonSolver(
        pythonPath,
        solutionFile,
        inputs,
        shape,
        part,
        cwd,
        timeoutSeconds,
        onSpawn,
        example.extra ?? {},
        onInput
      );
      const computed = parts[part - 1] ?? parts[0] ?? '';
      runs.push({ ...base, status: computed.trim() === expected.trim() ? 'pass' : 'fail', computed, output });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/cancelled/i.test(message)) throw error;
      const detail = error instanceof Error && 'detail' in error ? (error.detail as string | undefined) : undefined;
      runs.push({ ...base, status: 'error', message, detail });
    }
  }
  return runs;
}
