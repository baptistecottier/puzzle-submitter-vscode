import { FetchedExamples, PuzzleExample } from '../types';
import { findAll, HtmlElement, parseHtml, textOf } from '../core/htmlTree';
import { ElementObject } from '../core/htmlPyObject';
import { evaluate, PyObject, PyValue } from '../core/pyExpr';
import locatorTable from './aocExampleLocators.json';

// Ported from aocd-example-parser (https://github.com/wimglenn/aocd-example-parser, MIT —
// see THIRD_PARTY_NOTICES.md), the "reference" parser aocd's Puzzle.examples uses.
// aocExampleLocators.json is that project's examples.json, unchanged: for each past
// puzzle, Python expressions saying where in the puzzle page its examples are (which
// <pre>/<code>/<li> holds the input, which the answers). It ships positions, never puzzle
// text — the examples themselves are always read from the user's own copy of the page,
// in keeping with Advent of Code's request not to redistribute puzzle content.
// To pick up a new year's puzzles, replace the JSON with the latest release's copy.

interface Locator {
  input_data?: string;
  answer_a?: string;
  answer_b?: string;
  extra?: Record<string, unknown> | null;
}

const locators = locatorTable as unknown as Record<string, Locator[]> & { default_locators: Required<Locator> };

class PageObject implements PyObject {
  constructor(private readonly root: HtmlElement) {}

  getAttr(name: string): PyValue {
    if (name === 'soup') return new ElementObject(this.root);
    throw new Error(`page has no attribute ${name}`);
  }

  callMethod(name: string): PyValue {
    throw new Error(`page has no method ${name}()`);
  }
}

/** Extracts a puzzle's examples from its page HTML, and how many parts the page showed.
 * Part 2's examples only exist once part 1 is solved (the page shows no part 2 text
 * before that); `maxPart` 1 (the event's last day) never looks for a part 2 answer.
 * Throws if the page has no puzzle text. */
export function extractAocExamples(html: string, year: number, day: number, maxPart: number): FetchedExamples {
  const root = parseHtml(html);
  const articles = findAll(root, 'article');
  if (articles.length === 0) throw new Error('no puzzle text found on the page.');
  if (articles.length > 2) throw new Error('unexpected puzzle page layout (more than two parts).');
  const [articleA, articleB] = articles;

  const scope: Record<string, PyValue> = { page: new PageObject(root) };
  for (const [part, article] of [['a', articleA], ['b', articleB]] as const) {
    if (!article) continue; // b_* stay undefined while part 2 is locked, as in aocd
    for (const tag of ['code', 'pre', 'em'] as const) scope[`${part}_${tag}`] = findAll(article, tag).map(textOf);
    scope[`${part}_li`] = findAll(article, 'li').map((li) => new ElementObject(li));
  }

  const defaults = locators.default_locators;
  const key = `${year}/${String(day).padStart(2, '0')}`;
  const examples: PuzzleExample[] = [];
  for (const locator of locators[key] ?? [defaults]) {
    const read = (field: 'input_data' | 'answer_a' | 'answer_b'): string | undefined => {
      if (field === 'answer_b' && (!articleB || maxPart < 2)) return undefined;
      let value: PyValue;
      try {
        value = evaluate(field in locator ? locator[field]! : defaults[field], scope);
      } catch {
        return undefined;
      }
      if (Array.isArray(value)) value = value.every((v) => typeof v === 'string') ? value.join('\n') : null;
      return typeof value === 'string' ? value.replace(/[\r\n]+$/, '') : undefined;
    };
    const inputData = read('input_data');
    if (inputData === undefined) continue;
    const example: PuzzleExample = { input_data: inputData };
    const answerA = read('answer_a');
    const answerB = read('answer_b');
    if (answerA !== undefined) example.answer_a = answerA;
    if (answerB !== undefined) example.answer_b = answerB;
    if (locator.extra && Object.keys(locator.extra).length) example.extra = locator.extra;
    examples.push(example);
  }
  return { examples, parts: Math.min(articles.length, maxPart) };
}
