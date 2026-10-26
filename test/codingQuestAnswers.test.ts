import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCodingQuestAnswers } from '../src/providers/codingQuestAnswers';
import { checkWithoutSubmitting, referenceAnswer, storePublishedAnswers } from '../src/core/publishedAnswers';
import { getSolvedParts } from '../src/core/progress';
import { codingQuestProvider, codingQuestPuzzleUrl } from '../src/providers/assistProvider';

// Shaped like the archive's solutions page: one table per edition, rows in day order.
const page = `<h1>Puzzle Solutions</h1>
<h2>2022 prequel</h2><table><thead><tr><th>Original date</th><th>Title</th><th>Answer</th></tr></thead>
<tbody><tr><td>28 February 2022</td><td>First</td><td>95</td></tr><tr><td>1 March 2022</td><td>Second</td><td>cookies</td></tr></tbody></table>
<h2>2024 challenge</h2><table><thead><tr><th>Original date</th><th>Title</th><th>Answer</th></tr></thead>
<tbody><tr><td>4 March 2024</td><td>Day one</td><td>191274</td></tr><tr><td>5 March 2024</td><td>Day two</td><td>258956/256237</td></tr></tbody></table>
<h2>Notes</h2><table><tbody><tr><td>a</td><td>b</td><td>not an answer</td></tr></tbody></table>`;

test("the archive's editions map to this extension's groups — the prequel is the practice track — answers by day", () => {
  assert.deepEqual(Object.fromEntries(parseCodingQuestAnswers(page)), {
    practice_2022: ['95', 'cookies'],
    challenge_2024: ['191274', '258956/256237'],
  });
});

function memento() {
  const store = new Map<string, unknown>();
  return { get: (k: string, d: unknown) => (store.has(k) ? store.get(k) : d), update: async (k: string, v: unknown) => void store.set(k, v) } as never;
}

test("a published answer is only a reference: storing one doesn't mark the part solved", async () => {
  const state = memento();
  const ctx = { group: 'challenge_2024', index: '2', part: 1 };
  await storePublishedAnswers(state, codingQuestProvider, ctx, ['258956/256237']);
  assert.deepEqual(referenceAnswer(state, codingQuestProvider, ctx, 1), { answer: '258956/256237', published: true });
  assert.deepEqual(getSolvedParts(state, codingQuestProvider, ctx), []);
});

test('an answer matching the published one (spaces aside) counts as solving the part; a wrong one does not', async () => {
  const state = memento();
  const ctx = { group: 'challenge_2024', index: '1', part: 1 };
  await storePublishedAnswers(state, codingQuestProvider, ctx, ['191274']);
  assert.equal(await checkWithoutSubmitting(state, codingQuestProvider, ctx, '191275', ''), 'mismatch');
  assert.deepEqual(getSolvedParts(state, codingQuestProvider, ctx), []);
  assert.equal(await checkWithoutSubmitting(state, codingQuestProvider, ctx, ' 191274\n', ''), 'match');
  assert.deepEqual(getSolvedParts(state, codingQuestProvider, ctx), [1]);
});

test("Coding Quest's puzzle links point at each day's page in the archive", () => {
  assert.equal(codingQuestPuzzleUrl({ group: 'challenge_2022', index: '1' }), 'https://pbaumgarten.com/course/6/topic/44/doc/286');
  assert.equal(codingQuestPuzzleUrl({ group: 'challenge_2023', index: '10' }), 'https://pbaumgarten.com/course/6/topic/46/doc/310');
  assert.equal(codingQuestPuzzleUrl({ group: 'practice_2022', index: '5' }), 'https://pbaumgarten.com/course/6/topic/45/doc/300');
  assert.equal(codingQuestPuzzleUrl({ group: 'challenge_2024', index: '10' }), 'https://pbaumgarten.com/course/6/topic/43/doc/285');
});

test("a day's input is the text file its archive page links; a page without one has none", async () => {
  const { findCodingQuestInputLink } = await import('../src/providers/codingQuestAnswers.js');
  const withFile = '<nav><a href="/files/elsewhere.txt">x</a></nav><article><p><a href="/files/c6/t44/d286/1-2-may-2022.txt">1-2-May-2022.txt</a></p></article>';
  assert.equal(findCodingQuestInputLink(withFile), '/files/c6/t44/d286/1-2-may-2022.txt');
  assert.equal(findCodingQuestInputLink('<article><img src="/images/c6/t44/010-inputdata.png"></article>'), undefined);
});
