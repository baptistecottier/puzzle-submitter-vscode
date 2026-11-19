import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { formatDuration, getTimes, renderScoreboard, setTime, strip, symbol, writeScoreboard } from '../src/core/scoreboard';

class FakeMemento {
  private store = new Map<string, unknown>();
  get<T>(key: string, defaultValue: T): T {
    return (this.store.has(key) ? this.store.get(key) : defaultValue) as T;
  }
  async update(key: string, value: unknown): Promise<void> {
    this.store.set(key, value);
  }
}

const day = (index: string, solved: number, seconds?: number, parts = 2) => ({ index, solved, parts, seconds });

test('formatDuration: ms under a second, seconds under a minute, then minutes', () => {
  assert.equal(formatDuration(0.0001), '<1 ms');
  assert.equal(formatDuration(0.0031), '3 ms');
  assert.equal(formatDuration(1.24), '1.2 s');
  assert.equal(formatDuration(125), '2 min 05 s');
});

test('symbol: fast and slow full solves, one part only, unsolved', () => {
  assert.equal(symbol(day('1', 2, 0.5)), '█');
  assert.equal(symbol(day('1', 2, 12)), '▓');
  assert.equal(symbol(day('1', 2)), '▓'); // solved, never timed
  assert.equal(symbol(day('1', 1, 0.1)), '░');
  assert.equal(symbol(day('1', 0)), ' ');
  assert.equal(symbol(undefined), ' ');
});

test('strip: blocks of five, a numbered event keeps days at their own position', () => {
  assert.equal(strip([day('1', 2, 1), day('2', 2, 1), day('4', 1), day('7', 2, 30)]), '`██ ░ ` ` ▓`');
  // a non-numbered event is listed as it comes
  assert.equal(strip([day('a', 2, 1), day('b', 0)]), '`█ `');
});

test('renderScoreboard: one row per event, stars and total time', () => {
  const board = renderScoreboard(
    [
      { label: '2024', days: [day('1', 2, 0.5), day('2', 1, 2), day('3', 0)] },
      { label: '2023', days: [day('1', 2)] },
    ],
    'Python 3.13 · Apple M3 · 18 November 2026'
  );
  const lines = board.split('\n');
  assert.equal(lines[0], '<!-- scoreboard:start -->');
  assert.equal(lines[lines.length - 1], '<!-- scoreboard:end -->');
  assert.ok(lines.includes('| 2024 | `█░ ` | 3/6 | 2.5 s |'), board); // 0.5 s + 2 s
  assert.ok(lines.includes('| 2023 | `▓` | 2/2 |  |'), board); // never timed: no total
  assert.match(board, /Python 3\.13 · Apple M3 · 18 November 2026<\/sub>/);
});

test('writeScoreboard: creates, adds after the title, then replaces in place', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'puzzle-submitter-scoreboard-test-'));
  const readme = path.join(dir, 'README.md');

  assert.equal(writeScoreboard(readme, '<!-- scoreboard:start -->\nA\n<!-- scoreboard:end -->', 'repo'), 'created');
  assert.equal(fs.readFileSync(readme, 'utf8'), '# repo\n\n<!-- scoreboard:start -->\nA\n<!-- scoreboard:end -->\n');

  fs.writeFileSync(readme, '# Puzzles\n\nMy solutions.\n\n## Setup\n\nRun it.\n');
  assert.equal(writeScoreboard(readme, '<!-- scoreboard:start -->\nA\n<!-- scoreboard:end -->', 'x'), 'added');
  assert.equal(
    fs.readFileSync(readme, 'utf8'),
    '# Puzzles\n\n<!-- scoreboard:start -->\nA\n<!-- scoreboard:end -->\n\nMy solutions.\n\n## Setup\n\nRun it.\n'
  );

  assert.equal(writeScoreboard(readme, '<!-- scoreboard:start -->\nB\n<!-- scoreboard:end -->', 'x'), 'replaced');
  const text = fs.readFileSync(readme, 'utf8');
  assert.ok(text.includes('\nB\n') && !text.includes('\nA\n'));
  assert.ok(text.endsWith('## Setup\n\nRun it.\n')); // the rest of the README is untouched
});

test('times are kept per site, and forgotten when a run fails', async () => {
  const state = new FakeMemento() as unknown as import('vscode').Memento;
  await setTime(state, 'aoc', '2024', '1', 0.5);
  await setTime(state, 'aoc', '2024', '2', 1.5);
  await setTime(state, 'codingquest', '2022', '1', 9);
  assert.deepEqual(getTimes(state, 'aoc'), { '2024': { '1': 0.5, '2': 1.5 } });

  await setTime(state, 'aoc', '2024', '1', undefined);
  assert.deepEqual(getTimes(state, 'aoc'), { '2024': { '2': 1.5 } });
  await setTime(state, 'aoc', '2024', '2', undefined);
  assert.deepEqual(getTimes(state, 'aoc'), {}); // an event with nothing left is dropped
  assert.deepEqual(getTimes(state, 'codingquest'), { '2022': { '1': 9 } });
});
