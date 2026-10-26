import * as crypto from 'node:crypto';
import { PuzzleContext, PuzzleExample, PuzzleInputParts, PuzzleProvider, SubmitResult } from '../types';
import { extractEcExamples } from './ecExamples';

// Detection + the fetch/decrypt pipeline below are ported from this project's own
// working scripts/get_cases.py (everybodycodes repo) — that script is the source of
// truth for these endpoints, not guesswork.
const EVENTS_RE = /events\/year_(\d{4})\/solutions\/quest_(\d{2})/;
const STORIES_RE = /stories\/story_(\d{2})\/solutions\/quest_(\d{2})/;
// GridOS quests are rules programs (.rules files, one per part folder, part_I/II/III), run by
// the extension's own GridOS engine (core/gridos.ts) — not by a Python solver(). On the
// site, GridOS N is event 3000 + N.
const GRIDOS_RE = /gridos\/gridos_(\d+)\/quest_(\d+)(?:\/part_(I{1,3}))?/;
const GRIDOS_EVENT_OFFSET = 3000;

/** GridOS tournaments are events 3001, 3002, … on the site. */
export function isGridosGroup(group: string): boolean {
  return /^30\d\d$/.test(group);
}

/** Pure so it can be unit tested without a network call. A GridOS part's recorded
 * "answer" is the JSON of your best scores ({"heads":1,"states":200,…}), the way the
 * site itself reads it back. */
export function parseGridosBest(answer: string | undefined): Record<string, number> | undefined {
  if (!answer) return undefined;
  try {
    const parsed = JSON.parse(answer);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, number>) : undefined;
  } catch {
    return undefined;
  }
}

/** Submits a GridOS program for one part — the endpoint the site's own simulator posts to
 * once every test passes. The server runs it again and keeps your best of each score. */
export async function submitGridosProgram(ctx: PuzzleContext, token: string, program: string): Promise<SubmitResult> {
  const response = await fetch(`https://api.everybody.codes/event/${ctx.group}/quest/${ctx.index}/part/${ctx.part}/answerQos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(token) },
    body: JSON.stringify({ rules: program }),
  });
  return parseSubmitBody(response.status, await response.text());
}

function cookieHeader(token: string): string {
  return `everybody-codes=${token}`;
}

async function ecFetch(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: { ...init.headers, Cookie: cookieHeader(token) },
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('Everybody Codes rejected the session token — it may have expired.');
  }
  if (!response.ok) {
    throw new Error(`Everybody Codes returned HTTP ${response.status} for ${url}.`);
  }
  return response;
}

/** Pure so it can be unit tested without a network call. Everybody Codes never rejects
 * an expired or invalid session cookie: it answers 200 as if logged out — /user/me with
 * "id": null and no seed, a quest with only its public key1 — confirmed from real
 * responses. Unchecked, an expired token silently looked like "only part 1 exists"
 * (part 1's input/examples only, no reference answers), so this turns it into an error. */
export function signedInSeed(me: { id?: unknown; seed?: unknown }): number {
  if (me.id === null || me.id === undefined || typeof me.seed !== 'number') {
    throw new Error(
      'Everybody Codes doesn\'t recognize the session token — it has probably expired. Set a new one with "Set Token for Current Site".'
    );
  }
  return me.seed;
}

/** The user's input seed — and, every time, the check that the token is still signed in. */
async function fetchSeed(token: string): Promise<number> {
  const response = await ecFetch('https://api.everybody.codes/user/me', token);
  return signedInSeed((await response.json()) as { id?: unknown; seed?: unknown });
}

async function fetchEncryptedInputs(ctx: PuzzleContext, seed: number, token: string): Promise<Record<string, string>> {
  const url = ctx.group.startsWith('30')
    ? `https://everybody.codes/assets/${ctx.group}/${ctx.index}/input.json`
    : `https://everybody.codes/assets/${ctx.group}/${ctx.index}/input/${seed}.json`;
  const response = await ecFetch(url, token);
  return (await response.json()) as Record<string, string>;
}

async function fetchKeys(ctx: PuzzleContext, token: string): Promise<Record<string, string>> {
  const response = await ecFetch(`https://api.everybody.codes/event/${ctx.group}/quest/${ctx.index}`, token);
  return (await response.json()) as Record<string, string>;
}

/** Pure so it can be unit tested without a network call. The same endpoint fetchKeys
 * uses for decryption keys also carries the confirmed answer for every part already
 * solved, as plain text (answer1/answer2/answer3, right next to key1/key2/key3) —
 * confirmed from a real response. Unlike AoC there's no page to scrape here at all, and
 * no risk of it being client-rendered. Stops at the first missing part, matching how
 * parts unlock in order (there's no answer3 without answer1/answer2 already present). */
export function parseQuestAnswers(data: Record<string, string>): string[] {
  const answers: string[] = [];
  for (let part = 1; part <= 3; part++) {
    const answer = data[`answer${part}`];
    if (typeof answer !== 'string') break;
    answers.push(answer);
  }
  return answers;
}

/** AES/CBC decrypt, IV = first 16 chars of the key — exactly as get_cases.py does it. Auto-padding covers PKCS5/7. */
function decrypt(key: string, encryptedHex: string): string {
  const keyBytes = Buffer.from(key, 'utf8');
  const algorithm = { 16: 'aes-128-cbc', 24: 'aes-192-cbc', 32: 'aes-256-cbc' }[keyBytes.length];
  if (!algorithm) {
    throw new Error(`Unexpected Everybody Codes key length: ${keyBytes.length} bytes.`);
  }
  const iv = Buffer.from(key.slice(0, 16), 'utf8');
  const decipher = crypto.createDecipheriv(algorithm, keyBytes, iv);
  return Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]).toString('utf8');
}

/** The submit response shape isn't documented anywhere (the reference script never inspected it) — read
 * defensively and fall back to surfacing the raw body rather than guessing at a field that may not exist. */
export function parseSubmitBody(status: number, bodyText: string): SubmitResult {
  if (status === 401 || status === 403) {
    return { status: 'unknown', message: 'Everybody Codes rejected the session token — it may have expired.' };
  }
  let parsed: Record<string, unknown> | undefined;
  try {
    const json = JSON.parse(bodyText);
    if (json && typeof json === 'object') parsed = json as Record<string, unknown>;
  } catch {
    // not JSON — fall through
  }
  const bodyMessage = typeof parsed?.message === 'string' ? parsed.message : undefined;

  if (status === 409) {
    // Confirmed from real use: the API answers 409 when this part was already solved
    // (doesn't distinguish same vs. different answer in the body).
    return { status: 'already-solved', message: bodyMessage ?? "You've already solved this part." };
  }

  if (!status.toString().startsWith('2')) {
    return { status: 'unknown', message: `HTTP ${status}: ${bodyText.slice(0, 200)}` };
  }

  const correct = parsed?.correct ?? parsed?.success ?? parsed?.isCorrect;
  if (correct === true) {
    return { status: 'correct', message: bodyMessage ?? 'Correct!' };
  }
  if (correct === false) {
    return { status: 'incorrect', message: bodyMessage ?? 'Incorrect answer.' };
  }
  return {
    status: 'unknown',
    message: `Submitted — response shape wasn't recognized, check the output channel.\n${bodyText.slice(0, 500)}`,
  };
}

export const everybodyCodesProvider: PuzzleProvider = {
  id: 'everybodycodes',
  label: 'Everybody Codes',
  maxPart: 3,
  itemNoun: 'Quest',
  solverInputShape: 'parts-dict',
  tokenPrompt:
    "Value of the 'everybody-codes' cookie from everybody.codes — log in, open dev tools → Application/Storage → Cookies.",

  groupLabel(group) {
    if (isGridosGroup(group)) return `GridOS ${Number(group) - GRIDOS_EVENT_OFFSET}`;
    // Yearly events use a plain 4-digit year; stories use a plain, small story number —
    // never confirmed to collide in practice (AoC/EC years are always 4 digits).
    return /^\d{4}$/.test(group) ? group : `Story ${group}`;
  },

  // A plain sort on the raw group interleaves years/stories/GridOS (e.g. story "3" falls
  // between years "2024" and "2025", since it's a shorter numeric string) — group by
  // category first, in the same order the site's own nav uses (Events, Stories, GridOS),
  // then by number within each.
  groupSortKey(group) {
    if (isGridosGroup(group)) return `2_${group.padStart(6, '0')}`;
    if (/^\d{4}$/.test(group)) return `0_${group}`;
    return `1_${group.padStart(6, '0')}`;
  },

  detect(relativeFilePath) {
    const event = EVENTS_RE.exec(relativeFilePath);
    if (event) {
      return { group: event[1], index: String(Number(event[2])), part: 1 };
    }
    const story = STORIES_RE.exec(relativeFilePath);
    if (story) {
      // Best-effort: the API "event" id for stories isn't confirmed anywhere in this
      // project's existing tooling, unlike yearly events. Verify against a real token.
      return { group: String(Number(story[1])), index: String(Number(story[2])), part: 1 };
    }
    const gridos = GRIDOS_RE.exec(relativeFilePath);
    if (gridos) {
      return {
        group: String(GRIDOS_EVENT_OFFSET + Number(gridos[1])),
        index: String(Number(gridos[2])),
        part: gridos[3] ? gridos[3].length : 1,
      };
    }
    return undefined;
  },

  supportsRunner(ctx) {
    return !isGridosGroup(ctx.group);
  },

  puzzleUrl(ctx) {
    if (isGridosGroup(ctx.group)) {
      return `https://everybody.codes/gridos/${Number(ctx.group) - GRIDOS_EVENT_OFFSET}/quests/${ctx.index}`;
    }
    // Confirmed base pattern only (event's quest list) — not deep-linked to a specific quest.
    return `https://everybody.codes/event/${ctx.group}/quests`;
  },

  // Not offered for GridOS — see supportsRunner above, there's no per-quest solver() to
  // scaffold a stub for. Reuses groupLabel's same 4-digit-year heuristic to pick between
  // the two real layouts.
  scaffoldPath(ctx) {
    const quest = ctx.index.padStart(2, '0');
    if (/^\d{4}$/.test(ctx.group)) {
      return `events/year_${ctx.group}/solutions/quest_${quest}.py`;
    }
    return `stories/story_${ctx.group.padStart(2, '0')}/solutions/quest_${quest}.py`;
  },

  async fetchInput(ctx, token) {
    // The API hands back every unlocked part's encrypted blob/key in one response each —
    // decrypt whichever parts are actually available rather than just ctx.part.
    const seed = await fetchSeed(token);
    const [inputs, keys] = await Promise.all([fetchEncryptedInputs(ctx, seed, token), fetchKeys(ctx, token)]);
    const parts: PuzzleInputParts = {};
    for (const part of [1, 2, 3]) {
      const encrypted = inputs[String(part)];
      const key = keys[`key${part}`];
      if (encrypted && key) {
        parts[String(part)] = decrypt(key, encrypted);
      }
    }
    if (Object.keys(parts).length === 0) {
      throw new Error(`No input/key found for quest ${ctx.index} — it may not be unlocked yet.`);
    }
    return parts;
  },

  // Each part's description is encrypted with that part's key (the same key as its
  // input), so only unlocked parts' examples can be read — part 1's key is even handed
  // out without logging in, the rest come with the token once the previous part is solved.
  async fetchExamples(ctx, token) {
    const [description, keys] = await Promise.all([
      ecFetch(`https://everybody.codes/assets/${ctx.group}/${ctx.index}/description.json`, token).then(
        (response) => response.json() as Promise<Record<string, string>>
      ),
      fetchKeys(ctx, token),
      fetchSeed(token), // only to fail on an expired token instead of returning part 1 alone
    ]);
    const examples: PuzzleExample[] = [];
    let parts = 0;
    for (const part of [1, 2, 3] as const) {
      const key = keys[`key${part}`];
      const encrypted = description[String(part)];
      if (!key || !encrypted) break;
      examples.push(...extractEcExamples(decrypt(key, encrypted), `${ctx.group}/${ctx.index}`, part));
      parts = part;
    }
    return { examples, parts };
  },

  async fetchRecordedAnswers(ctx, token) {
    const [keys] = await Promise.all([fetchKeys(ctx, token), fetchSeed(token)]);
    return parseQuestAnswers(keys);
  },

  async submit(ctx, token, answer) {
    const response = await fetch(
      `https://api.everybody.codes/event/${ctx.group}/quest/${ctx.index}/part/${ctx.part}/answer`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(token) },
        body: JSON.stringify({ answer }),
      }
    );
    return parseSubmitBody(response.status, await response.text());
  },
};
