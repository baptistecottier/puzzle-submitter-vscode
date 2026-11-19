import { PuzzleContext, PuzzleProvider, SubmitResult } from '../types';

const SITE = 'https://i18n-puzzles.com';

/** i18n-puzzles has no API, only its Django web pages. Inputs are personal: logged out, a
 * puzzle's input is a 401 "Requires authentication". Answers go through the puzzle page's
 * own form, a POST to /puzzle/N/submit guarded by Django's CSRF check. Puzzles are
 * numbered flat, with no year or event: problems/problem_NN/. */

const EXPIRED = "i18n-puzzles didn't accept your session cookie — it has probably expired; clear the token and set a new one.";

function headers(cookie: string, contact: string): Record<string, string> {
  return {
    Cookie: cookie,
    'User-Agent': `puzzle-submitter-vscode (${contact.trim() || 'contact not configured'})`,
  };
}

/** Pure so it can be unit tested without a network call. The verdict is the bold text in
 * the response page's first paragraph, e.g. "<p><b>That is not the correct answer.</b>
 * … Please wait a minute before submitting again.</p>". Only the wrong-answer wording has
 * been seen for real; a verdict saying "correct" without "not" is taken as right, and anything else is passed through as 'unknown' with the site's own
 * words, rather than guessed at. */
export function parseI18nResponse(html: string): SubmitResult {
  const body = html.includes('</nav>') ? html.slice(html.indexOf('</nav>')) : html;
  const verdict = body.match(/<b>([\s\S]*?)<\/b>/i)?.[1].replace(/\s+/g, ' ').trim() ?? '';
  const wait = body.match(/Please wait[^.<]*\./i)?.[0];
  if (/not the correct answer/i.test(verdict)) {
    return { status: 'incorrect', message: wait ? `${verdict} ${wait}` : verdict };
  }
  // Not seen for real yet: assumed to read like the wrong one without the "not".
  if (/\bcorrect\b/i.test(verdict) && !/\bnot\b/i.test(verdict)) {
    return { status: 'correct', message: verdict };
  }
  return {
    status: 'unknown',
    message: verdict ? `i18n-puzzles said: ${verdict}` : 'Unexpected response from i18n-puzzles — check the output channel.',
  };
}

/** Pure so it can be unit tested without a network call. A solved puzzle's page drops the
 * answer form and shows "Your puzzle answer was: 107989" instead. The exact markup around
 * the answer hasn't been seen, so any tags between the label and the answer are skipped. */
export function parseI18nRecordedAnswer(html: string): string | undefined {
  const answer = html.match(/Your puzzle answer was:?\s*(?:<[^>]*>\s*)*([^<]+)/i)?.[1].trim();
  return answer || undefined;
}

async function fetchPuzzlePage(ctx: PuzzleContext, token: string, contact: string): Promise<Response> {
  const page = await fetch(`${SITE}/puzzle/${ctx.index}/`, { redirect: 'manual', headers: headers(`sessionid=${token}`, contact) });
  if (!page.ok) throw new Error(`i18n-puzzles returned HTTP ${page.status} for puzzle ${ctx.index}'s page.`);
  return page;
}

function setCookieValue(response: Response, name: string): string | undefined {
  for (const line of response.headers.getSetCookie()) {
    const match = new RegExp(`^${name}=([^;]*)`).exec(line);
    if (match) return match[1];
  }
  return undefined;
}

export const i18nPuzzlesProvider: PuzzleProvider = {
  id: 'i18n-puzzles',
  label: 'i18n-puzzles',
  maxPart: 1,
  itemNoun: 'Puzzle',
  solverInputShape: 'text',
  usesToken: true,
  tokenPrompt: "Value of the 'sessionid' cookie from i18n-puzzles.com — log in, open dev tools → Application/Storage → Cookies.",

  detect(relativeFilePath) {
    const match = /problems\/problem_(\d{2})\//.exec(relativeFilePath);
    // flat numbering, no year/group on this site
    return match ? { group: '', index: String(Number(match[1])), part: 1 } : undefined;
  },

  puzzleUrl: (ctx) => `${SITE}/puzzle/${ctx.index}/`,

  async fetchInput(ctx, token, contact) {
    const response = await fetch(`${SITE}/puzzle/${ctx.index}/input`, {
      redirect: 'manual',
      headers: headers(`sessionid=${token}`, contact),
    });
    if (response.status === 401 || (response.status >= 300 && response.status < 400)) throw new Error(EXPIRED);
    if (!response.ok) throw new Error(`i18n-puzzles returned HTTP ${response.status} for puzzle ${ctx.index}'s input.`);
    return { '1': (await response.text()).replace(/\n$/, '') };
  },

  async fetchRecordedAnswers(ctx, token, contact) {
    const html = await (await fetchPuzzlePage(ctx, token, contact)).text();
    if (/please log in/i.test(html)) throw new Error(EXPIRED);
    const recorded = parseI18nRecordedAnswer(html);
    return recorded === undefined ? [] : [recorded];
  },

  async submit(ctx: PuzzleContext, token, answer, contact) {
    // Django wants the form's CSRF token in the body, the matching csrftoken cookie, and
    // a same-site Referer; loading the puzzle page hands out the first two.
    const pageUrl = `${SITE}/puzzle/${ctx.index}/`;
    const page = await fetchPuzzlePage(ctx, token, contact);
    const html = await page.text();
    const form = html.slice(html.indexOf(`/puzzle/${ctx.index}/submit`));
    const formToken = form.match(/name="csrfmiddlewaretoken" value="([^"]+)"/)?.[1];
    if (!html.includes(`/puzzle/${ctx.index}/submit`) || !formToken) {
      if (/please log in/i.test(html)) throw new Error(EXPIRED);
      // The recorded answer itself is read back through fetchRecordedAnswers (see core/submitRecorder.ts).
      if (parseI18nRecordedAnswer(html) !== undefined) return { status: 'already-solved', message: "You've already solved this puzzle." };
      return { status: 'unknown', message: `Puzzle ${ctx.index}'s page has no answer form — not open yet?` };
    }
    const csrfCookie = setCookieValue(page, 'csrftoken');
    const response = await fetch(`${SITE}/puzzle/${ctx.index}/submit`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        ...headers(`sessionid=${token}${csrfCookie ? `; csrftoken=${csrfCookie}` : ''}`, contact),
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: pageUrl,
      },
      body: new URLSearchParams({ csrfmiddlewaretoken: formToken, answer }).toString(),
    });
    if (response.status === 401 || (response.status >= 300 && response.status < 400)) throw new Error(EXPIRED);
    if (response.status === 403) throw new Error("i18n-puzzles refused the submission (HTTP 403, most likely its CSRF check) — nothing was submitted.");
    if (!response.ok) throw new Error(`i18n-puzzles returned HTTP ${response.status} for puzzle ${ctx.index}'s answer.`);
    return parseI18nResponse(await response.text());
  },
};
