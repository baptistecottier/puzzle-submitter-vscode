import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractEcExamples } from '../src/providers/ecExamples';

// Synthetic descriptions shaped like Everybody Codes' (one <div class="example"> per
// part, notes in <pre class="note">) — never real quest text.
function description(example: string): string {
  return `<svg><path d="M0 0"/></svg>\r\n<div class="description"><h3>Part I</h3><div class="p">Story.</div></div>\r\n<div class="example">\r\n<b>Example based on the following notes:</b>\r\n${example}\r\n</div>`;
}

const note = (text: string) => `<div class="description example-note"><pre class="note">\r\n${text}\r\n</pre></div>`;

test('the note is the input (newlines normalized and trimmed), the last bold value the answer', () => {
  const html = description(`${note('AB\r\nCD')}<div class="p">There are <b>2</b> rows, so the total is <b>7</b>.</div>`);
  assert.deepEqual(extractEcExamples(html, '2099/1', 1), [{ input_data: 'AB\nCD', answer_a: '7' }]);
});

test("the answer field follows the part (answer_b, answer_c), since each part has its own notes", () => {
  const html = description(`${note('x')}<div class="p"><b>9</b></div>`);
  assert.deepEqual(extractEcExamples(html, '2099/1', 3), [{ input_data: 'x', answer_c: '9' }]);
});

test('a phrase gives its last number; a phrase without one is skipped; a symbol string is kept whole', () => {
  const phrase = description(`${note('x')}<div class="p">It takes <b>13 + 13 = 26 steps</b>, <b>the shortest path</b>.</div>`);
  assert.equal(extractEcExamples(phrase, '2099/1', 1)[0].answer_a, '26');
  const symbols = description(`${note('x')}<div class="p">The result is <b>&gt;.- -.- ^,-</b>.</div>`);
  assert.equal(extractEcExamples(symbols, '2099/1', 1)[0].answer_a, '>.- -.- ^,-');
});

test('bolds in list items (other cases) and in multi-line diagrams (marked cells) lose to the explanation', () => {
  const html = description(
    `${note('x')}<div class="p">Only <pre> <b>Alpha</b> </pre> fits.</div>` +
      `<ul><li><b>Beta</b> does not fit.</li></ul><div class="p"><pre>\n#<b>~</b>#\n#<b>~</b>#\n</pre></div>`
  );
  assert.equal(extractEcExamples(html, '2099/1', 1)[0].answer_a, 'Alpha');
});

test('a bold diagram cell is still used when nothing else is bold (an answer marked in a table)', () => {
  const html = description(`${note('x')}<div class="p"><pre>\nToken  Won\nAB       <b>26</b>\n</pre></div>`);
  assert.equal(extractEcExamples(html, '2099/1', 1)[0].answer_a, '26');
});

test('a locator table entry overrides the default (2024/5 part 1: the answer is the last cell of a table)', () => {
  const html = description(`${note('2 3\n4 5')}<div class="p">Ends <b>behind</b>.</div><pre>Round  Number\n1:     3345\n2:     2323</pre>`);
  assert.deepEqual(extractEcExamples(html, '2024/5', 1), [{ input_data: '2 3\n4 5', answer_a: '2323' }]);
});

test('several notes are several examples, each answered by what follows it up to the next note', () => {
  const html = description(
    `${note('AB')}<div class="p">This gives <b>12</b>.</div>${note('CD')}<div class="p">And this <pre> <b>34</b> </pre>.</div>`
  );
  assert.deepEqual(extractEcExamples(html, '2099/1', 2), [
    { input_data: 'AB', answer_b: '12' },
    { input_data: 'CD', answer_b: '34' },
  ]);
});

test("a one-line note inside a sentence is a parameter, not another example; a later note with no answer isn't one either", () => {
  const html = description(
    `${note('AB')}<div class="p">With <pre class="note"> 50 </pre> blocks, it takes <b>27</b>.</div>${note('more\nnotes')}<div class="p">Nothing here.</div>`
  );
  assert.deepEqual(extractEcExamples(html, '2099/1', 2), [{ input_data: 'AB', answer_b: '27' }]);
});

test('notes repeated word for word (the same example with growing parameters) keep only the last one', () => {
  const html = description(
    `${note('ABC')}<div class="p">Once: <b>34</b>.</div>${note('ABC')}<div class="p">Ten times: <b>72</b>.</div>${note('ABC')}<div class="p">In full: <b>3442321</b>.</div>`
  );
  assert.deepEqual(extractEcExamples(html, '2099/1', 3), [{ input_data: 'ABC', answer_c: '3442321' }]);
});

test('an answer made only of numbers is kept whole ("39 122"), not reduced to its last number', () => {
  const html = description(`${note('x')}<div class="p">The answer is <pre><b>39 122</b></pre>.</div>`);
  assert.equal(extractEcExamples(html, '2099/1', 3)[0].answer_c, '39 122');
});

test('no example block means no examples', () => {
  assert.deepEqual(extractEcExamples('<div class="description">Nothing to try here.</div>', '2099/1', 1), []);
});
