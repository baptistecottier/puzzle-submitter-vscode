import { PuzzleContext, PuzzleProvider, SubmitResult } from '../types';

const DETECT_RE = /events\/year_(\d{4})\/day_(\d{2})\//;

function userAgent(contact: string): string {
  const who = contact.trim() || 'contact not configured (set puzzleSubmitter.contact)';
  return `puzzle-submitter-vscode (${who})`;
}

function cookieHeader(token: string): string {
  return `session=${token}`;
}

/** Pure so it can be unit tested without a network call. Mirrors the phrases AoC's website uses. */
export function parseAocResponse(html: string): SubmitResult {
  if (/already complete it|already solved/i.test(html)) {
    return { status: 'already-solved', message: "You've already solved this part." };
  }
  if (/That's the right answer/i.test(html)) {
    return { status: 'correct', message: "That's the right answer!" };
  }
  if (/You gave an answer too recently/i.test(html)) {
    const wait = html.match(/You have (?:[\d.]+s )?(?:left to wait|to wait)[^.]*\./i)?.[0];
    return { status: 'rate-limited', message: wait ?? 'You gave an answer too recently — wait before retrying.' };
  }
  if (/That's not the right answer/i.test(html)) {
    const hint = /too high/i.test(html) ? ' (too high)' : /too low/i.test(html) ? ' (too low)' : '';
    return { status: 'incorrect', message: `That's not the right answer${hint}.` };
  }
  return { status: 'unknown', message: 'Unexpected response from Advent of Code — check the output channel.' };
}

/** Pure so it can be unit tested without a network call. The day page lists each solved
 * part's confirmed answer in order ("Your puzzle answer was <code>...</code>"), part 1
 * first — this is how the AoC community's own tooling (e.g. the `aocd` package) reads
 * back answers for already-solved days, since the submit response for an already-solved
 * part never repeats the answer text. AoC's real markup wraps this across lines
 * ("was\n            <code>74</code>"), so the gap before <code> has to tolerate
 * whitespace/newlines, not just a single literal space. */
export function parseRecordedAnswers(html: string): string[] {
  return [...html.matchAll(/Your puzzle answer was\s*<code[^>]*>([^<]*)<\/code>/gi)].map((m) => m[1].trim());
}

async function fetchAoc(url: string, token: string, contact: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      Cookie: cookieHeader(token),
      'User-Agent': userAgent(contact),
    },
  });
  if (response.status === 404) {
    throw new Error('Puzzle not found (wrong year/day, or not unlocked yet).');
  }
  if (response.status === 400) {
    throw new Error('Advent of Code rejected the session token (400) — it may have expired.');
  }
  if (!response.ok) {
    throw new Error(`Advent of Code returned HTTP ${response.status}.`);
  }
  return response;
}

export const aocProvider: PuzzleProvider = {
  id: 'aoc',
  label: 'Advent of Code',
  maxPart: 2,
  itemNoun: 'Day',
  solverInputShape: 'text',
  tokenPrompt:
    "Value of the 'session' cookie from adventofcode.com — log in, open dev tools → Application/Storage → Cookies.",

  detect(relativeFilePath) {
    const match = DETECT_RE.exec(relativeFilePath);
    if (!match) return undefined;
    return { group: match[1], index: String(Number(match[2])), part: 1 };
  },

  // The event's last day has always been a single-part puzzle (it unlocks once you have
  // every other star, and completing it grants the 50th star for free — no second part).
  // Which day counts as "last" isn't fixed: it's day 25 for 2015-2024, but the event
  // shortened to 12 days starting in 2025.
  maxPartFor(ctx) {
    const lastDay = Number(ctx.group) >= 2025 ? 12 : 25;
    return Number(ctx.index) === lastDay ? 1 : 2;
  },

  puzzleUrl(ctx: PuzzleContext) {
    return `https://adventofcode.com/${ctx.group}/day/${ctx.index}`;
  },

  scaffoldPath(ctx) {
    const day = ctx.index.padStart(2, '0');
    return `events/year_${ctx.group}/day_${day}/day_${day}.py`;
  },

  async fetchInput(ctx, token, contact) {
    const response = await fetchAoc(`https://adventofcode.com/${ctx.group}/day/${ctx.index}/input`, token, contact);
    const text = (await response.text()).replace(/\n$/, '');
    // AoC has one input per day, shared by both parts.
    return { '1': text, '2': text };
  },

  async fetchRecordedAnswers(ctx, token, contact) {
    const response = await fetchAoc(`https://adventofcode.com/${ctx.group}/day/${ctx.index}`, token, contact);
    return parseRecordedAnswers(await response.text());
  },

  async submit(ctx, token, answer, contact) {
    const response = await fetchAoc(
      `https://adventofcode.com/${ctx.group}/day/${ctx.index}/answer`,
      token,
      contact,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ level: String(ctx.part), answer }).toString(),
      }
    );
    return parseAocResponse(await response.text());
  },
};
