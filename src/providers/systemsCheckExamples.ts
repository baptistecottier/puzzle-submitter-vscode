import { FetchedExamples, PuzzleExample } from '../types';
import { findAll, hasClass, parseHtml, textOf } from '../core/htmlTree';
import locatorTable from './systemsCheckExampleLocators.json';

// Mission pages are public and prose-only: an example's input is a <pre> block, but its
// expected answer is only written into a sentence ("...the answer is 4"), with no markup
// to find it by. systemsCheckExampleLocators.json says, per mission, which <pre> is each
// example's input (`pre`, counted over the mission text) and which inline <code> holds its
// answer (`code`, counted over the <code> elements outside <pre> blocks; `number: "last"`
// keeps the last number of a worked sum like "33 + 44 = 77"). Like the other providers'
// tables it holds positions, never puzzle text — everything is read from the user's own
// copy of the page. Part 2 is not on the page until it's unlocked, so only part 1 is read.
// A mission not in the table (a newer one) gets its first input-shaped <pre> and no answer;
// blocks drawn with box characters are illustrations, not input.

interface Locator {
  pre: number;
  answer_a?: { code: number; number?: 'last' };
}

const locators = locatorTable as Record<string, Locator[]>;
const ILLUSTRATION = /[─-╿]/;

function trimNewlines(text: string): string {
  return text.replace(/^[\r\n]+|[\r\n]+$/g, '');
}

/** Extracts a mission's examples from its page HTML. Throws if the page has no mission text. */
export function extractSystemsCheckExamples(html: string, mission: number): FetchedExamples {
  const article = findAll(parseHtml(html), 'article').find((el) => hasClass(el, 'mission-doc'));
  if (!article) throw new Error('no mission text found on the page.');
  const pres = findAll(article, 'pre');
  const inPre = new Set(pres.flatMap((pre) => findAll(pre, 'code')));
  const codes = findAll(article, 'code').filter((code) => !inPre.has(code));

  const known = locators[String(mission)];
  if (!known) {
    const input = pres.map((pre) => trimNewlines(textOf(pre))).find((text) => text !== '' && !ILLUSTRATION.test(text));
    return { examples: input === undefined ? [] : [{ input_data: input }], parts: 1 };
  }

  const examples: PuzzleExample[] = [];
  for (const locator of known) {
    const pre = pres[locator.pre];
    if (!pre) continue;
    const example: PuzzleExample = { input_data: trimNewlines(textOf(pre)) };
    const where = locator.answer_a;
    const code = where && codes[where.code];
    if (where && code) {
      const text = textOf(code).trim();
      const answer = where.number === 'last' ? text.match(/-?\d+(?:\.\d+)?(?!.*\d)/)?.[0] : text;
      if (answer) example.answer_a = answer;
    }
    examples.push(example);
  }
  return { examples, parts: 1 };
}
