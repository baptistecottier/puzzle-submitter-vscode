import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readJsonParts, writeJsonParts } from '../src/core/localInput';

function tmpPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'puzzle-submitter-localinput-test-'));
  return path.join(dir, 'quest_01.json');
}

test('readJsonParts returns undefined when nothing is cached yet', () => {
  assert.equal(readJsonParts(tmpPath()), undefined);
});

test('writeJsonParts then readJsonParts round-trips', () => {
  const file = tmpPath();
  writeJsonParts(file, { '1': 'first part input' });
  assert.deepEqual(readJsonParts(file), { '1': 'first part input' });
});

test('writing part 2 does not drop part 1 already saved', () => {
  const file = tmpPath();
  writeJsonParts(file, { '1': 'first' });
  writeJsonParts(file, { '2': 'second' });
  assert.deepEqual(readJsonParts(file), { '1': 'first', '2': 'second' });
});

test('writing the same part again overwrites just that part', () => {
  const file = tmpPath();
  writeJsonParts(file, { '1': 'old', '2': 'second' });
  writeJsonParts(file, { '1': 'new' });
  assert.deepEqual(readJsonParts(file), { '1': 'new', '2': 'second' });
});

test('a corrupt/non-JSON file reads as undefined instead of throwing', () => {
  const file = tmpPath();
  fs.writeFileSync(file, 'not json at all', 'utf8');
  assert.equal(readJsonParts(file), undefined);
});
