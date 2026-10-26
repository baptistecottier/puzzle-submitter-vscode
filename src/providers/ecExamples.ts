import { PuzzleExample } from '../types';
import { findAll, hasClass, HtmlElement, parseHtml, textOf } from '../core/htmlTree';
import { ElementObject } from '../core/htmlPyObject';
import { evaluate, PyValue } from '../core/pyExpr';
import locatorTable from './ecExampleLocators.json';

// Everybody Codes has no aocd-style example parser to port, so this is the same idea
// built for its quest descriptions. Each part's description has one
// <div class="example">: the notes to run on are its <pre class="note">, and the answer
// is written into the explanation, usually as the last bold value. The default below
// reads it that way, one example per note; ecExampleLocators.json overrides it per part
// ("event/quest/part") — an entry's missing field falls back to notes[i]/answers[i] —
// where a description says it differently, with expressions in the same Python subset
// aocd's locators use. Like aocd's table, it holds positions, never puzzle text.
//
// Scope for those expressions, all taken from the part's example block:
//   notes — text of each <pre class="note">, surrounding newlines trimmed
//   answers — the default answer read after each note (None where there's none)
//   b     — text of each <b> (b[0] is the "Example based on the following notes:" header)
//   pre   — text of each <pre>, notes included
//   li    — each <li>, as an element (.text, .codes, ...)
//   example — the block itself, as an element
//   page  — the whole description, as an element (for an example told outside the block)

interface Locator {
  input_data?: string;
  answer?: string;
  extra?: Record<string, unknown>;
}

const locators = locatorTable as Record<string, Locator[]>;

const ANSWER_FIELDS = { 1: 'answer_a', 2: 'answer_b', 3: 'answer_c' } as const;

function trimNewlines(text: string): string {
  return text.replace(/^[\r\n]+|[\r\n]+$/g, '');
}

/** The elements enclosing `target` inside `root`, outermost first. */
function ancestorsOf(root: HtmlElement, target: HtmlElement): HtmlElement[] {
  const chain: HtmlElement[] = [];
  const walk = (el: HtmlElement): boolean => {
    for (const child of el.children) {
      if (child.kind !== 'element') continue;
      if (child === target) return true;
      chain.push(child);
      if (walk(child)) return true;
      chain.pop();
    }
    return false;
  };
  walk(root);
  return chain;
}

/** Reads a bold value as an answer: a single token as-is ("5", "BDCA", "[357,862]"),
 * numbers alone as-is ("39 122"), a symbol string as-is (">.- -.- ^,-"), the last number
 * of a phrase ("10 strikes", "13 + 13 = 26 steps"), and nothing for a phrase with no
 * number ("the shortest path"). */
function answerFrom(text: string): string | undefined {
  const value = text.trim();
  if (!value) return undefined;
  if (!/\s/.test(value) || /^-?\d+(?:[\s,]+-?\d+)*$/.test(value)) return value;
  const numbers = value.match(/-?\d+/g);
  if (numbers) return numbers[numbers.length - 1];
  return /[A-Za-z]{2,}/.test(value) ? undefined : value;
}

/** The default answer among `bolds`: the last that reads as one, preferring the
 * explanation's own sentences over list items (which tend to walk through other cases)
 * over cells of a multi-line diagram (which mark positions, not results). */
function guessAnswer(example: HtmlElement, bolds: HtmlElement[]): string | undefined {
  const PROSE = 0;
  const LIST_ITEM = 1;
  const DIAGRAM = 2;
  const tiers: string[][] = [[], [], []];
  for (const bold of bolds) {
    const answer = answerFrom(textOf(bold));
    if (answer === undefined) continue;
    const ancestors = ancestorsOf(example, bold);
    const inDiagram = ancestors.some((el) => el.tag === 'pre' && textOf(el).trim().includes('\n'));
    tiers[inDiagram ? DIAGRAM : ancestors.some((el) => el.tag === 'li') ? LIST_ITEM : PROSE].push(answer);
  }
  const tier = tiers.find((answers) => answers.length);
  return tier?.[tier.length - 1];
}

/** The example block split at each note: every <pre class="note"> with the bolds that
 * follow it, up to the next note — a part with several examples explains each one right
 * after its notes. A one-line note inside a sentence (<div class="p">) isn't an input
 * but a parameter the explanation mentions ("with 50 blocks"), so it doesn't split. */
function splitAtNotes(example: HtmlElement): { note: HtmlElement; bolds: HtmlElement[] }[] {
  const segments: { note: HtmlElement; bolds: HtmlElement[] }[] = [];
  const isInput = (note: HtmlElement, parent: HtmlElement) =>
    trimNewlines(textOf(note)).includes('\n') || !(parent.tag === 'div' && hasClass(parent, 'p'));
  const walk = (el: HtmlElement) => {
    for (const child of el.children) {
      if (child.kind !== 'element') continue;
      if (child.tag === 'pre' && hasClass(child, 'note') && isInput(child, el)) segments.push({ note: child, bolds: [] });
      else if (child.tag === 'b') segments[segments.length - 1]?.bolds.push(child);
      walk(child);
    }
  };
  walk(example);
  return segments;
}

/** Extracts one part's examples from its decrypted description HTML. Each example only
 * carries an answer for that part (answer_a/answer_b/answer_c for parts 1/2/3), since
 * every Everybody Codes part has its own example notes. */
export function extractEcExamples(html: string, key: string, part: 1 | 2 | 3): PuzzleExample[] {
  // Descriptions come with Windows line endings; a browser normalizes them, and so must this.
  const root = parseHtml(html.replace(/\r\n?/g, '\n'));
  const example = findAll(root, 'div').find((div) => hasClass(div, 'example'));
  if (!example) return [];

  const segments = splitAtNotes(example);
  const notes = segments.map((segment) => trimNewlines(textOf(segment.note)));
  const answers = segments.map((segment) => guessAnswer(example, segment.bolds) ?? null);
  const scope: Record<string, PyValue> = {
    notes,
    answers,
    b: findAll(example, 'b').map(textOf),
    pre: findAll(example, 'pre').map(textOf),
    li: findAll(example, 'li').map((li) => new ElementObject(li)),
    example: new ElementObject(example),
    page: new ElementObject(root),
  };
  const read = (source: string): string | undefined => {
    try {
      const value = evaluate(source, scope);
      return typeof value === 'string' ? value : undefined;
    } catch {
      return undefined;
    }
  };

  // By default every note is an example, answered by what follows it — except that a
  // later note with no answer after it is just more illustration, not another example,
  // and notes repeated word for word are the same example worked with growing
  // parameters, of which only the last (full-size) one matches the real puzzle's.
  const table = locators[`${key}/${part}`];
  const entries: Locator[] = table ?? notes.map((note, i) => (notes.indexOf(note, i + 1) === -1 ? {} : { input_data: 'None' }));
  const examples: PuzzleExample[] = [];
  entries.forEach((locator, i) => {
    const input = locator.input_data !== undefined ? read(locator.input_data) : notes[i];
    const answer = locator.answer !== undefined ? read(locator.answer) : answers[i] ?? undefined;
    if (input === undefined || (!table && i > 0 && answer === undefined)) return;
    const entry: PuzzleExample = { input_data: trimNewlines(input) };
    if (answer !== undefined) entry[ANSWER_FIELDS[part]] = answer.trim();
    if (locator.extra) entry.extra = locator.extra;
    examples.push(entry);
  });
  return examples;
}
