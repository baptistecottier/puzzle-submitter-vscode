import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAocExamples } from '../src/providers/aocExamples';

// Synthetic pages shaped like an Advent of Code day page (title, one <article> per
// unlocked part) — never real puzzle text, which shouldn't be redistributed.
function page(year: number, day: number, articles: string[]): string {
  return `<!DOCTYPE html><html><head><title>Day ${day} - Advent of Code ${year}</title>
<script>var x = "<article>";</script></head><body><main>
${articles.map((a) => `<article class="day-desc">${a}</article>`).join('\n<p>Your puzzle answer was <code>1</code>.</p>\n')}
</main></body></html>`;
}

const partA = '<h2>--- Day 3: Test ---</h2><p>For example:</p><pre><code>ab\ncd\n</code></pre><p>The total is <code><em>42</em></code>.</p>';
const partB = '<h2 id="part2">--- Part Two ---</h2><p>Now it is <code>total 99</code>.</p>';

test("a puzzle without a locator entry uses aocd's defaults: first <pre> is the input, each part's last <code> holds its answer", () => {
  assert.deepEqual(extractAocExamples(page(2099, 3, [partA, partB]), 2099, 3, 2), {
    examples: [{ input_data: 'ab\ncd', answer_a: '42', answer_b: '99' }],
    parts: 2,
  });
});

test('with part 2 still locked (one <article>), only the part 1 answer is extracted', () => {
  assert.deepEqual(extractAocExamples(page(2099, 3, [partA]), 2099, 3, 2), { examples: [{ input_data: 'ab\ncd', answer_a: '42' }], parts: 1 });
});

test("the event's last day (maxPart 1) never gets a part 2 answer, even with a second article", () => {
  assert.deepEqual(extractAocExamples(page(2099, 12, [partA, partB]), 2099, 12, 1), { examples: [{ input_data: 'ab\ncd', answer_a: '42' }], parts: 1 });
});

test("a puzzle with a locator entry uses it (2017/15 builds its input from two <code>s with str.format)", () => {
  const article = '<p><code>a</code> <code>b</code> <code>c</code> <code>65</code> <code>8921</code> answer <code>588</code></p>';
  assert.deepEqual(extractAocExamples(page(2017, 15, [article]), 2017, 15, 2).examples, [
    { input_data: 'Generator A starts with 65\nGenerator B starts with 8921', answer_a: '588' },
  ]);
});

test('a locator that fails to evaluate drops just that value (here: no <pre>, so no example at all)', () => {
  assert.deepEqual(extractAocExamples(page(2099, 3, ['<p>No example here: <code>7</code></p>']), 2099, 3, 2).examples, []);
});

test('a page with no puzzle text is an error, not an empty list', () => {
  assert.throws(() => extractAocExamples('<html><body>Please log in</body></html>', 2099, 3, 2), /no puzzle text/);
});
