import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, PyError } from '../src/core/pyExpr';

const scope = { a_code: ['x', '1 2  3', 'last'], a_pre: ['10\n2\nfoo\n10\n'], n: '6' };

test('indexing and slicing follow Python, including negative indices', () => {
  assert.equal(evaluate('a_code[-1]', scope), 'last');
  assert.deepEqual(evaluate('a_code[1:]', scope), ['1 2  3', 'last']);
  assert.deepEqual(evaluate('a_code[::2]', scope), ['x', 'last']);
  assert.equal(evaluate("'abcdef'[1:-1]", scope), 'bcde');
  assert.throws(() => evaluate('a_code[3]', scope), PyError);
});

test('str methods: split() on whitespace runs, split(sep), splitlines(), count, replace, join, format', () => {
  assert.deepEqual(evaluate('a_code[1].split()', scope), ['1', '2', '3']);
  assert.deepEqual(evaluate("'a, b'.split(', ')", scope), ['a', 'b']);
  assert.deepEqual(evaluate('a_pre[0].splitlines()', scope), ['10', '2', 'foo', '10']);
  assert.equal(evaluate("str(a_pre[0].count('10'))", scope), '2');
  assert.equal(evaluate("a_code[0].replace('x', 'y')", scope), 'y');
  assert.equal(evaluate("'\\t'.join(a_code[:2])", scope), 'x\t1 2  3');
  assert.equal(evaluate("'A {} B {}'.format(a_code[0], n)", scope), 'A x B 6');
});

test('comprehensions, set comprehensions and sorted(key=int)', () => {
  assert.deepEqual(evaluate('[s.upper() for s in a_code if s != "x"]', scope), ['1 2  3', 'LAST']);
  assert.deepEqual(evaluate('sorted({w for w in a_pre[0].split() if w.isdigit()}, key=int)', scope), ['2', '10']);
});

test('ints are arbitrary precision, like Python', () => {
  assert.equal(evaluate("str(int('9007199254740993') * int('3'))", scope), '27021597764222979');
  assert.equal(evaluate('str(0b001 + 0b110)', scope), '7');
});

test('a top-level "a, b" is a tuple; list repetition works', () => {
  assert.deepEqual(evaluate('a_code[0], n', scope), ['x', '6']);
  assert.equal(evaluate("'-'.join([n]*2)", scope), '6-6');
});

test('objects expose attributes and methods; "is None" compares identity', () => {
  const li = { getAttr: (name: string) => (name === 'em' ? null : 'text'), callMethod: () => null };
  assert.equal(evaluate('str(int(li.em is None))', { li }), '1');
  assert.equal(evaluate('li.text', { li }), 'text');
});

test("anything Python would raise on, or outside the subset, throws PyError instead of guessing", () => {
  assert.throws(() => evaluate('missing[0]', scope), PyError);
  assert.throws(() => evaluate("int('12a')", scope), PyError);
  assert.throws(() => evaluate("a_code[0] + 1", scope), PyError);
  assert.throws(() => evaluate('lambda: 1', scope), PyError);
  assert.throws(() => evaluate('{1: 2}', scope), PyError);
});
