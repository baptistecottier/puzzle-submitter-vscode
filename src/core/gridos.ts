import * as fs from 'node:fs';
import * as path from 'node:path';

/** Everybody Codes' GridOS, run locally: a port of the site's own simulator (read from its
 * public JavaScript bundle), so a program passes, fails and scores here exactly as it does
 * on everybody.codes — the same parsing ("//" comments, "/" separators, only the first five
 * columns of a rule read), the same step rule (exactly one rule must match: none or several
 * is an error, and a program has to reach STOP), the same checks (EXACT, TEXT, or the
 * part's validators), limits and scores: heads, then the states and rules *used*, steps,
 * and golf (non-comment lines longer than five characters). */

export interface GridosPoint {
  x: number;
  y: number;
}

/** One test case, as the site hands it out (a GridOS part's decrypted input). */
export interface GridosCase {
  startPoints: Record<string, GridosPoint>;
  data: string;
  expected: string;
  validate: string;
}

export interface GridosLimits {
  heads: number;
  states: number;
  rules: number;
  steps: number;
  bytes: number;
  /** Custom checks, used when a case's `validate` is neither EXACT nor TEXT: each entry is
   * [name, ...args], name one of COUNT, REGEXP_ROW, REGEXP_COLUMN. */
  validators?: unknown[][];
}

/** A GridOS part's decrypted input: its limits and test cases. */
export interface GridosPart {
  limits: GridosLimits;
  cases: GridosCase[];
}

export interface GridosCaseResult {
  /** 1-based, as the site numbers cases. */
  index: number;
  passed: boolean;
  /** The site's own error message ("[ ERROR 404 ] Missing rule for state …"), if any. */
  error?: string;
  /** The final grid, rows separated by newlines, blank cells as "_" (the site's EXACT form). */
  output: string;
  expected: string;
  validate: string;
  steps: number;
  rules: number;
  states: number;
}

export interface GridosScores {
  heads: number;
  states: number;
  rules: number;
  steps: number;
  golf: number;
}

export interface GridosRunResult {
  cases: GridosCaseResult[];
  passed: number;
  allPassed: boolean;
  /** Totals the way the site adds them up: heads once, states, rules and steps summed over
   * the cases. Only meaningful when allPassed — the site scores nothing otherwise. */
  scores: GridosScores;
}

interface Rule {
  read: string;
  next: string;
  write: string;
  move: string;
  /** Identifies the rule for "rules used" (the site uses its line number). */
  id: number;
}

const START = 'START';
const STOP = 'STOP';

function key(x: number, y: number): string {
  return `${x}|${y}`;
}

/** Rule READ against what the heads read: "*" anything, "!" any non-blank cell, otherwise
 * that exact symbol ("_" is a blank cell). */
function matches(read: string, data: string): boolean {
  let hits = 0;
  for (let i = 0; i < data.length; i++) {
    const want = read[i];
    const got = data[i];
    if (want === '*' || (want === '!' && got && got !== '_') || want === got) hits++;
  }
  return hits === data.length;
}

/** One run of a program on one test case — the site's simulator, minus its history and
 * debugger. */
class Machine {
  private readonly cells = new Map<string, string>();
  private minx = Infinity;
  private maxx = -Infinity;
  private miny = Infinity;
  private maxy = -Infinity;
  private startPoints: Record<string, GridosPoint> = {};
  private readonly heads: GridosPoint[] = [];
  private headCount = 0;
  private readonly rulesByState = new Map<string, Rule[]>();
  private state = START;
  steps = 0;
  readonly rulesUsed = new Set<number>();
  readonly statesUsed = new Set<string>();
  error: string | null = null;

  constructor(private readonly limits: GridosLimits) {}

  get headsDefined(): number {
    return this.headCount;
  }

  load(data: string, startPoints: Record<string, GridosPoint>): void {
    this.startPoints = startPoints;
    const rows = data.replace(/\r\n?/g, '\n').trim().split('\n');
    for (let y = 0; y < rows.length; y++) {
      this.miny = Math.min(this.miny, y);
      this.maxy = Math.max(this.maxy, y);
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const symbol = row[x];
        if (symbol !== '_') {
          this.cells.set(key(x, y), symbol);
          this.minx = Math.min(this.minx, x);
          this.maxx = Math.max(this.maxx, x);
        }
      }
    }
  }

  private fail(message: string): void {
    this.error = message;
  }

  run(program: string): void {
    const text = program.replace(/\r\n?/g, '\n');
    if (text.trim() === 'QUACK') return this.fail("[ ERROR 418 ] I'm a duck");
    if (!text.trim()) return this.fail('[ ERROR 404 ] Rules not found');
    if (text.length > this.limits.bytes) {
      return this.fail(`[ ERROR 422 ] Your code has ${program.length} bytes, but the limit is ${this.limits.bytes}`);
    }

    let line = 2;
    let ruleCount = 0;
    const lines = text.split('\n').map((l) => l.trim().replace(/\s+/g, ' '));
    let first = (lines.shift() ?? '').replace(/\/\/.*$/, '');
    while (first === '' && lines.length > 0) {
      first = (lines.shift() ?? '').replace(/\/\/.*$/, '');
      line++;
    }
    const headsLine = first.split(' ');
    if (headsLine[0] !== 'HEADS') return this.fail('[ ERROR 422 ] Your program must start with HEADS instruction');
    if (headsLine.length < 2 || headsLine[1].trim().length === 0) {
      return this.fail('[ ERROR 404 ] At least one starting position should be defined in the HEADS instruction');
    }
    const letters = headsLine[1].replace(/\//g, '').split('');
    this.headCount = letters.length;
    for (const letter of letters) {
      const start = this.startPoints[letter];
      if (!start) return this.fail(`[ ERROR 404 ] starting position '${letter}' not found`);
      this.heads.push({ x: start.x, y: start.y });
    }

    const reads = new Map<string, Set<string>>();
    for (let raw of lines) {
      raw = raw.replace(/\/\/.*$/, '').replace(/\s+/g, ' ').trim().replace(/\//g, '');
      if (raw.length === 0) {
        line++;
        continue;
      }
      const [state, read, next, write, move] = raw.split(' ');
      if (!state) return this.fail(`[ ERROR 422 ] Missing STATE argument in line ${line}`);
      if (!read) return this.fail(`[ ERROR 422 ] Missing READ argument in line ${line}`);
      if (!next) return this.fail(`[ ERROR 422 ] Missing NEXT-STATE argument in line ${line}`);
      if (!write) return this.fail(`[ ERROR 422 ] Missing WRITE argument in line ${line}`);
      if (!move) return this.fail(`[ ERROR 422 ] Missing MOVE in line ${line}`);
      if (!reads.has(state)) reads.set(state, new Set());
      const stateReads = reads.get(state)!;
      if (stateReads.has(read)) return this.fail(`[ ERROR 422 ] Duplicate rule for state ${state} and data ${read} in line ${line}`);
      if (this.headCount !== read.length) {
        return this.fail(
          `[ ERROR 422 ] Inconsistent number of heads: line ${line} defines ${read.length} head(s), but HEADS defined ${this.headCount} head(s)`
        );
      }
      if (read.length !== write.length) {
        return this.fail(
          `[ ERROR 422 ] Inconsistent number of heads: line ${line} defines ${read.length} values to read and ${write.length} values to write`
        );
      }
      if (move.length !== this.headCount) {
        return this.fail(
          `[ ERROR 422 ] Inconsistent number of heads: line ${line} defines ${move.length} moves, but HEADS defined ${this.headCount} head(s)`
        );
      }
      stateReads.add(read);
      if (!this.rulesByState.has(state)) this.rulesByState.set(state, []);
      this.rulesByState.get(state)!.push({ read, next, write, move, id: line });
      line++;
      ruleCount++;
      if (ruleCount > this.limits.rules) {
        return this.fail(`[ ERROR 422 ] You have defined ${ruleCount} rules, but the limit is ${this.limits.rules}`);
      }
    }
    if (this.headCount > this.limits.heads) {
      return this.fail(`[ ERROR 422 ] You have defined ${this.headCount} heads, but the limit is ${this.limits.heads}`);
    }
    this.runSteps();
  }

  private currentData(): string {
    let data = '';
    for (let h = 0; h < this.headCount; h++) {
      const { x, y } = this.heads[h];
      data += this.cells.get(key(x, y)) ?? '_';
    }
    return data;
  }

  private runSteps(): void {
    while (this.state !== STOP) {
      const data = this.currentData();
      let rule: Rule | null = null;
      for (const candidate of this.rulesByState.get(this.state) ?? []) {
        if (!matches(candidate.read, data)) continue;
        if (rule) {
          this.steps++;
          return this.fail(`[ ERROR 500 ] Multiple rules for state ${this.state} and data ${data}`);
        }
        rule = candidate;
      }
      if (!rule) {
        this.steps++;
        return this.fail(`[ ERROR 404 ] Missing rule for state ${this.state} and data ${data}`);
      }

      this.rulesUsed.add(rule.id);
      this.statesUsed.add(this.state);
      this.statesUsed.add(rule.next);
      this.state = rule.next;
      const written = new Map<string, string>();
      for (let h = 0; h < this.headCount; h++) {
        const head = this.heads[h];
        const cell = key(head.x, head.y);
        const symbol = rule.write[h];
        if (symbol !== '*') {
          if (symbol !== '_') this.cells.set(cell, symbol);
          else this.cells.delete(cell);
        }
        const before = written.get(cell);
        if (before !== undefined && before !== symbol && symbol !== '*') {
          this.steps++;
          return this.fail('[ ERROR 500 ] Multiple heads trying to set the same cell to different values');
        }
        if (symbol !== '*') written.set(cell, symbol);

        const move = rule.move[h];
        if (move === 'R' || move === 'L') {
          head.x += move === 'R' ? 1 : -1;
          this.minx = Math.min(this.minx, head.x);
          this.maxx = Math.max(this.maxx, head.x);
        } else if (move === 'U' || move === 'D') {
          head.y += move === 'D' ? 1 : -1;
          this.miny = Math.min(this.miny, head.y);
          this.maxy = Math.max(this.maxy, head.y);
        } else if (move === 'S') {
          this.minx = Math.min(this.minx, head.x);
          this.maxx = Math.max(this.maxx, head.x);
          this.miny = Math.min(this.miny, head.y);
          this.maxy = Math.max(this.maxy, head.y);
        } else {
          this.steps++;
          return this.fail(`[ ERROR 505 ] Invalid move: ${move}`);
        }
      }

      this.steps++;
      if (this.steps > this.limits.steps) {
        return this.fail(`[ ERROR 507 ] You have reached the maximum number of steps: ${this.limits.steps}`);
      }
      if (Math.max(Math.abs(this.minx), Math.abs(this.maxx), Math.abs(this.miny), Math.abs(this.maxy)) > 1e4) {
        return this.fail('[ ERROR 508 ] Head reached max safe coords +/- 10000');
      }
      // The site checks this as it records each step, without stopping the run.
      if (this.statesUsed.size > this.limits.states) {
        this.error = `[ ERROR 507 ] You have reached the maximum number of states: ${this.limits.states}`;
      }
    }
  }

  /** The grid inside the area the run touched, trimmed to the filled cells; rows without
   * any filled cell are left out (the site's getGridAsString). */
  grid(separator = '\n', blank = '_'): string {
    let [left, right, top, bottom] = [Infinity, -Infinity, Infinity, -Infinity];
    for (let y = this.miny; y <= this.maxy; y++) {
      for (let x = this.minx; x <= this.maxx; x++) {
        if (this.cells.has(key(x, y))) {
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
    }
    const rows: string[] = [];
    for (let y = top; y <= bottom; y++) {
      let row = '';
      let filled = 0;
      for (let x = left; x <= right; x++) {
        const symbol = this.cells.get(key(x, y));
        if (symbol !== undefined) {
          row += symbol;
          filled++;
        } else {
          row += blank;
        }
      }
      if (filled > 0) rows.push(row);
    }
    return rows.join(separator);
  }

  private rowsOrColumns(byRow: boolean): string[] {
    const lines: string[] = [];
    const [outerFrom, outerTo, innerFrom, innerTo] = byRow
      ? [this.miny, this.maxy, this.minx, this.maxx]
      : [this.minx, this.maxx, this.miny, this.maxy];
    for (let outer = outerFrom; outer <= outerTo; outer++) {
      let text = '';
      for (let inner = innerFrom; inner <= innerTo; inner++) {
        text += (byRow ? this.cells.get(key(inner, outer)) : this.cells.get(key(outer, inner))) ?? ' ';
      }
      lines.push(text.trim());
    }
    return lines;
  }

  validate(mode: string, expected: string): boolean {
    if (mode === 'EXACT') return this.grid() === expected;
    if (mode === 'TEXT') return this.grid('', '') === expected;
    let ok = true;
    for (const [name, ...args] of this.limits.validators ?? []) {
      if (name === 'COUNT') {
        let count = 0;
        for (let y = this.miny; y <= this.maxy; y++) {
          for (let x = this.minx; x <= this.maxx; x++) if (this.cells.get(key(x, y)) === args[0]) count++;
        }
        ok = ok && count === args[1];
      } else if (name === 'REGEXP_ROW' || name === 'REGEXP_COLUMN') {
        const pattern = new RegExp(String(args[0]));
        ok = ok && this.rowsOrColumns(name === 'REGEXP_ROW').every((text) => {
          pattern.lastIndex = 0;
          return text === '' || pattern.test(text);
        });
      } else {
        this.error = `Unknown validator ${String(name)}`;
        return false;
      }
    }
    return ok;
  }
}

/** The site's golf score: lines still longer than five characters once comments are cut. */
export function gridosGolf(program: string): number {
  return program
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => line.replace(/\s*\/\/.*/, '').length > 5).length;
}

/** Runs a program on every test case of a part. Unlike the site, which stops at the first
 * failing case, this runs them all — so every failure can be shown at once. */
export function runGridos(program: string, part: GridosPart): GridosRunResult {
  const cases: GridosCaseResult[] = [];
  let heads = 0;
  for (const [i, testCase] of part.cases.entries()) {
    const machine = new Machine(part.limits);
    machine.load(testCase.data, testCase.startPoints);
    machine.run(program);
    const passed = !machine.error && machine.validate(testCase.validate, testCase.expected);
    heads = machine.headsDefined;
    cases.push({
      index: i + 1,
      passed,
      ...(machine.error ? { error: machine.error } : {}),
      output: machine.grid(),
      expected: testCase.expected,
      validate: testCase.validate,
      steps: machine.steps,
      rules: machine.rulesUsed.size,
      states: machine.statesUsed.size,
    });
  }
  const passed = cases.filter((c) => c.passed).length;
  return {
    cases,
    passed,
    allPassed: passed === cases.length && cases.length > 0,
    scores: {
      heads,
      states: cases.reduce((sum, c) => sum + c.states, 0),
      rules: cases.reduce((sum, c) => sum + c.rules, 0),
      steps: cases.reduce((sum, c) => sum + c.steps, 0),
      golf: gridosGolf(program),
    },
  };
}

/** Parses a GridOS part's decrypted input, or explains why it isn't one. */
export function parseGridosPart(text: string): GridosPart {
  const parsed = JSON.parse(text) as Partial<GridosPart>;
  if (!parsed || !Array.isArray(parsed.cases) || !parsed.limits) throw new Error('not GridOS test data (no limits/cases)');
  return parsed as GridosPart;
}

/** The scores a .rules file can be written to minimise, from its name: q1p1_heads.rules. */
export const GRIDOS_TARGETS = ['heads', 'states', 'rules', 'steps', 'golf'] as const;
export type GridosTarget = (typeof GRIDOS_TARGETS)[number];

/** A quest's part folder (quest_N/part_II for part 2), from any file in that quest — a
 * part folder's .rules file, or one at the quest's level (postprocessing.py, …). */
export function gridosPartDir(fileInQuest: string, part: number): string | undefined {
  let dir = path.dirname(fileInQuest);
  if (/^part_I{1,3}$/.test(path.basename(dir))) dir = path.dirname(dir);
  if (!/^quest_\d+$/.test(path.basename(dir))) return undefined;
  return path.join(dir, `part_${'I'.repeat(part)}`);
}

/** The .rules files of a part folder, the per-score ones first, in score order. */
export function listGridosRules(partDir: string): { name: string; path: string; target?: GridosTarget }[] {
  if (!fs.existsSync(partDir)) return [];
  const order = (target?: GridosTarget) => (target ? GRIDOS_TARGETS.indexOf(target) : GRIDOS_TARGETS.length);
  return fs
    .readdirSync(partDir)
    .filter((name) => name.endsWith('.rules'))
    .map((name) => ({ name, path: path.join(partDir, name), target: GRIDOS_TARGETS.find((t) => name.endsWith(`_${t}.rules`)) }))
    .sort((a, b) => order(a.target) - order(b.target) || a.name.localeCompare(b.name));
}
