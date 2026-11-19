import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as vscode from 'vscode';
import { SiteId } from '../types';

/**
 * How long each solution took (the last Run All / Sync), kept between sessions, and the
 * scoreboard written from them into the README. The times are what "Run All Parts" already
 * measures: preprocessing() and solver() only, never the interpreter start-up or imports.
 */

/** Seconds per puzzle: group -> index -> seconds. */
export type PuzzleTimes = Record<string, Record<string, number>>;

const timesKey = (siteId: SiteId) => `puzzleSubmitter.times.${siteId}`;

export function getTimes(state: vscode.Memento, siteId: SiteId): PuzzleTimes {
  return state.get<PuzzleTimes>(timesKey(siteId), {});
}

/** Remembers how long a puzzle took, or forgets it when `seconds` is undefined (the run
 * failed, so an older time would no longer describe the solution). */
export async function setTime(
  state: vscode.Memento,
  siteId: SiteId,
  group: string,
  index: string,
  seconds: number | undefined
): Promise<PuzzleTimes> {
  const times = structuredClone(getTimes(state, siteId));
  if (seconds === undefined) {
    delete times[group]?.[index];
    if (times[group] && !Object.keys(times[group]).length) delete times[group];
  } else {
    (times[group] ??= {})[index] = seconds;
  }
  await state.update(timesKey(siteId), times);
  return times;
}

/** 3 ms, 1.2 s, 2 min 05 s. */
export function formatDuration(seconds: number): string {
  if (seconds < 0.0005) return '<1 ms';
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)} min ${String(whole % 60).padStart(2, '0')} s`;
}

// ---- the scoreboard ----

/** One puzzle of an event, as the scoreboard sees it. */
export interface ScoreboardDay {
  index: string;
  solved: number;
  parts: number;
  seconds?: number;
}

export interface ScoreboardRow {
  label: string;
  days: ScoreboardDay[];
}

/** Solved in under this many seconds earns the full block. */
export const FAST_SECONDS = 10;

export function symbol(day: ScoreboardDay | undefined): string {
  if (!day || day.solved === 0) return ' ';
  if (day.solved < day.parts) return '░';
  return day.seconds !== undefined && day.seconds < FAST_SECONDS ? '█' : '▓';
}

/** One character per day, in blocks of five. A numbered event keeps each day at its own
 * position (a day with no solution is a gap); anything else is listed as it comes. */
export function strip(days: ScoreboardDay[]): string {
  const numbered = days.length > 0 && days.every((d) => /^\d+$/.test(d.index));
  let cells: string[];
  if (numbered) {
    const byIndex = new Map(days.map((d) => [Number(d.index), d]));
    const last = Math.max(...byIndex.keys());
    cells = Array.from({ length: last }, (_, i) => symbol(byIndex.get(i + 1)));
  } else {
    cells = days.map(symbol);
  }
  const blocks: string[] = [];
  for (let i = 0; i < cells.length; i += 5) blocks.push(`\`${cells.slice(i, i + 5).join('').padEnd(Math.min(5, cells.length - i))}\``);
  return blocks.join(' ');
}

export const START = '<!-- scoreboard:start -->';
export const END = '<!-- scoreboard:end -->';

export function renderScoreboard(rows: ScoreboardRow[], footer: string): string {
  const table = rows.map((row) => {
    const solved = row.days.reduce((n, d) => n + d.solved, 0);
    const total = row.days.reduce((n, d) => n + d.parts, 0);
    const timed = row.days.filter((d) => d.seconds !== undefined);
    const time = timed.length ? formatDuration(timed.reduce((n, d) => n + d.seconds!, 0)) : '';
    return `| ${row.label} | ${strip(row.days)} | ${solved}/${total} | ${time} |`;
  });
  return [
    START,
    '## Scoreboard',
    '',
    '| Event | Puzzles | ★ | Time |',
    '| :-- | :-- | --: | --: |',
    ...table,
    '',
    `<sub>\`█\` solved in under ${FAST_SECONDS} s &emsp; \`▓\` solved &emsp; \`░\` one part only &emsp; \` \` not solved<br>`,
    `${footer}</sub>`,
    END,
  ].join('\n');
}

/** Puts the scoreboard in the README between its markers, replacing the previous one — or
 * right after the title when there is none yet, or in a new README. Returns what it did. */
export function writeScoreboard(readmePath: string, scoreboard: string, title: string): 'replaced' | 'added' | 'created' {
  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(readmePath, `# ${title}\n\n${scoreboard}\n`, 'utf8');
    return 'created';
  }
  const text = fs.readFileSync(readmePath, 'utf8');
  const start = text.indexOf(START);
  const end = text.indexOf(END, start + 1);
  if (start !== -1 && end !== -1) {
    fs.writeFileSync(readmePath, text.slice(0, start) + scoreboard + text.slice(end + END.length), 'utf8');
    return 'replaced';
  }
  const [head, ...tail] = text.split(/\n\n/);
  fs.writeFileSync(readmePath, `${head}\n\n${scoreboard}\n\n${tail.join('\n\n')}`.replace(/\n+$/, '') + '\n', 'utf8');
  return 'added';
}

/** "Python 3.13 · Apple M3 · 18 November 2026" — where and when the times were measured. */
export async function scoreboardFooter(pythonPath: string, today = new Date()): Promise<string> {
  const python = await new Promise<string | undefined>((resolve) =>
    cp.execFile(pythonPath, ['-c', 'import platform;print(platform.python_version())'], (error, stdout) =>
      resolve(error ? undefined : stdout.trim() || undefined)
    )
  );
  return [python && `Python ${python}`, machineName(), `${today.getDate()} ${today.toLocaleString('en-GB', { month: 'long' })} ${today.getFullYear()}`]
    .filter(Boolean)
    .join(' · ');
}

/** The processor's name (Apple M3…). */
export function machineName(): string {
  if (process.platform === 'darwin') {
    try {
      const brand = cp.execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string'], { encoding: 'utf8' }).trim();
      if (brand) return brand;
    } catch {
      // fall through
    }
  }
  return os.cpus()[0]?.model ?? process.arch;
}
