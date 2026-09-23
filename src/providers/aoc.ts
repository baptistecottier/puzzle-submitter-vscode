import { PuzzleContext, PuzzleProvider, SubmitResult } from '../types';

const DETECT_RE = /events\/year_(\d{4})\/day_(\d{2})\//;

function userAgent(contact: string): string {
  const who = contact.trim() || 'contact not configured (set puzzleSubmit.contact)';
  return `puzzle-submit-vscode (${who})`;
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
  tokenPrompt:
    "Value of the 'session' cookie from adventofcode.com — log in, open dev tools → Application/Storage → Cookies.",

  detect(relativeFilePath) {
    const match = DETECT_RE.exec(relativeFilePath);
    if (!match) return undefined;
    return { group: match[1], index: String(Number(match[2])), part: 1 };
  },

  puzzleUrl(ctx: PuzzleContext) {
    return `https://adventofcode.com/${ctx.group}/day/${ctx.index}`;
  },

  inputPath(ctx: PuzzleContext) {
    // Matches pythonfw/aocp.py's save_input_to_file exactly, so aocp picks up the same file.
    const day = ctx.index.padStart(2, '0');
    return `events/year_${ctx.group}/day_${day}/day_${day}.input`;
  },

  async fetchInput(ctx, token, contact) {
    const response = await fetchAoc(`https://adventofcode.com/${ctx.group}/day/${ctx.index}/input`, token, contact);
    return (await response.text()).replace(/\n$/, '');
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
