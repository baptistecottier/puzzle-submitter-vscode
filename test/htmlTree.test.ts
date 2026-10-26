import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findAll, parseHtml, textOf } from '../src/core/htmlTree';

test('find_all returns descendants in document order, including ones nested in a match', () => {
  const root = parseHtml('<article><p>a <code>1</code></p><pre><code>2\n3</code></pre><ul><li><code>4</code></li></ul></article>');
  assert.deepEqual(findAll(root, 'code').map(textOf), ['1', '2\n3', '4']);
  assert.deepEqual(findAll(root, 'pre').map(textOf), ['2\n3']);
});

test('entities are decoded in text', () => {
  const root = parseHtml('<code>a &lt;b&gt; &amp; &quot;c&quot; &#39;d&#39; &#x41;</code>');
  assert.equal(textOf(findAll(root, 'code')[0]), 'a <b> & "c" \'d\' A');
});

test("whitespace-only text collapses to one newline/space outside <pre>, like BeautifulSoup — but not inside it", () => {
  const root = parseHtml('<li>\n  <code>x</code>  <em>y</em></li><pre>  \n  </pre>');
  assert.equal(textOf(findAll(root, 'li')[0]), '\nx y');
  assert.equal(textOf(findAll(root, 'pre')[0]), '  \n  ');
});

test('comments count as children but not as text; scripts are dropped', () => {
  const root = parseHtml('<code>a<!-- note -->b</code><script>if (1 < 2) { x = "<code>no</code>"; }</script>');
  const code = findAll(root, 'code');
  assert.equal(code.length, 1);
  assert.equal(textOf(code[0]), 'ab');
  assert.equal(code[0].children.length, 3);
});

test('void elements and self-closing tags take no children; a stray end tag is ignored', () => {
  const root = parseHtml('<p>a<br>b<img src="x.png"/>c</span>d</p>');
  assert.equal(textOf(findAll(root, 'p')[0]), 'abcd');
});

test("a '>' inside a quoted attribute value doesn't end the tag", () => {
  const root = parseHtml('<span title="a > b">x</span>');
  assert.equal(textOf(findAll(root, 'span')[0]), 'x');
});
