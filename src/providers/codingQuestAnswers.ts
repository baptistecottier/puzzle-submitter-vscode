import { PuzzleContext, PuzzleInputParts } from '../types';
import { HtmlElement, parseHtml, textOf } from '../core/htmlTree';

/** Coding Quest's answers are the same for every player, and its archive publishes them:
 * one table per edition ("2022 prequel", "2022 challenge", …), one row per day in order,
 * with the answer in the last column. */
export const CODING_QUEST_SOLUTIONS_URL = 'https://pbaumgarten.com/course/6/topic/43/doc/321';

/** Pure so it can be unit tested without a network call. Maps each edition to this
 * extension's group names — the prequel is the "practice" track, the rest "challenge" —
 * and lists its answers by day (index 0 = day 1). */
export function parseCodingQuestAnswers(html: string): Map<string, string[]> {
  const editions = new Map<string, string[]>();
  let current: string[] | undefined;
  const walk = (el: HtmlElement) => {
    for (const child of el.children) {
      if (child.kind !== 'element') continue;
      if (child.tag === 'h2') {
        const heading = /^(\d{4})\s+(prequel|challenge)$/i.exec(textOf(child).trim());
        current = heading ? [] : undefined;
        if (heading) editions.set(`${heading[2].toLowerCase() === 'prequel' ? 'practice' : 'challenge'}_${heading[1]}`, current!);
        continue;
      }
      if (child.tag === 'tr' && current) {
        const cells = child.children.filter((c): c is HtmlElement => c.kind === 'element' && c.tag === 'td');
        if (cells.length >= 3) current.push(textOf(cells[cells.length - 1]).trim());
        continue;
      }
      walk(child);
    }
  };
  walk(parseHtml(html));
  return editions;
}

let page: Promise<Map<string, string[]>> | undefined;

/** The published answer for one puzzle (as a one-part list), or none. The archive page is
 * read once per session, however many puzzles ask. */
export async function fetchCodingQuestAnswers(ctx: PuzzleContext, contact: string): Promise<string[]> {
  page ??= fetch(CODING_QUEST_SOLUTIONS_URL, {
    headers: { 'User-Agent': `puzzle-submitter-vscode (${contact.trim() || 'contact not configured'})` },
  })
    .then((response) => {
      if (!response.ok) throw new Error(`The Coding Quest archive returned HTTP ${response.status}.`);
      return response.text();
    })
    .then(parseCodingQuestAnswers)
    .catch((error) => {
      page = undefined; // try again next time rather than caching a failure
      throw error;
    });
  const answer = (await page).get(ctx.group)?.[Number(ctx.index) - 1];
  return answer ? [answer] : [];
}

/** The archive's pages per edition: its topic, and the page of day 1 — the following days
 * are the next pages in order (2022 day 1 is topic 44, page 286; day 2 is page 287, …). */
const CODING_QUEST_PAGES: Record<string, { topic: number; firstPage: number; days: number }> = {
  practice_2022: { topic: 45, firstPage: 296, days: 5 },
  challenge_2022: { topic: 44, firstPage: 286, days: 10 },
  challenge_2023: { topic: 46, firstPage: 301, days: 10 },
  challenge_2024: { topic: 47, firstPage: 311, days: 9 },
};

export function codingQuestPuzzleUrl(ctx: { group: string; index: string }): string {
  const edition = CODING_QUEST_PAGES[ctx.group];
  const day = Number(ctx.index);
  if (!edition || day < 1 || day > edition.days) return 'https://pbaumgarten.com/course/6/topic/43/doc/285';
  return `https://pbaumgarten.com/course/6/topic/${edition.topic}/doc/${edition.firstPage + day - 1}`;
}


const ARCHIVE = 'https://pbaumgarten.com';

function archiveFetch(url: string, contact: string): Promise<Response> {
  return fetch(url, { headers: { 'User-Agent': `puzzle-submitter-vscode (${contact.trim() || 'contact not configured'})` } }).then(
    (response) => {
      if (!response.ok) throw new Error(`The Coding Quest archive returned HTTP ${response.status} for ${url}.`);
      return response;
    }
  );
}

/** Pure so it can be unit tested without a network call. A day's page links its input as
 * one text file (/files/…/NN-D-month-YYYY.txt); a page without one either has its input
 * as an image or its numbers in the puzzle text itself. */
export function findCodingQuestInputLink(html: string): string | undefined {
  const article = html.slice(html.indexOf('<article'), html.indexOf('</article>'));
  return /href="(\/files\/[^"]+\.txt)"/.exec(article)?.[1];
}

/** The day's input, read from the file its archive page links. The same for everyone. */
export async function fetchCodingQuestInput(ctx: PuzzleContext, _token: string, contact: string): Promise<PuzzleInputParts> {
  const page = codingQuestPuzzleUrl(ctx);
  if (!CODING_QUEST_PAGES[ctx.group] || page.endsWith('/doc/285')) {
    throw new Error(`The Coding Quest archive has no page for ${ctx.group} day ${ctx.index}.`);
  }
  const link = findCodingQuestInputLink(await (await archiveFetch(page, contact)).text());
  if (!link) {
    throw new Error(
      `${ctx.group} day ${ctx.index} has no input file in the archive — its input is an image, or its numbers are in the puzzle text (${page}).`
    );
  }
  const text = await (await archiveFetch(ARCHIVE + link, contact)).text();
  return { '1': text.replace(/\r\n?/g, '\n').replace(/\n$/, '') };
}
