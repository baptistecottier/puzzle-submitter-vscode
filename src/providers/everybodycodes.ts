import * as crypto from 'node:crypto';
import { PuzzleContext, PuzzleInputParts, PuzzleProvider, SubmitResult } from '../types';
import { readJsonParts, resolveLocalInputPath, writeJsonParts } from '../core/localInput';

// Detection + the fetch/decrypt pipeline below are ported from this project's own
// working scripts/get_cases.py (everybodycodes repo) — that script is the source of
// truth for these endpoints, not guesswork.
const EVENTS_RE = /events\/year_(\d{4})\/solutions\/quest_(\d{2})/;
const STORIES_RE = /stories\/story_(\d{2})\/solutions\/quest_(\d{2})/;

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

async function getSeed(token: string): Promise<number> {
  const response = await ecFetch('https://api.everybody.codes/user/me', token);
  const data = (await response.json()) as { seed: number };
  return data.seed;
}

async function fetchEncryptedInputs(ctx: PuzzleContext, token: string): Promise<Record<string, string>> {
  const url = ctx.group.startsWith('30')
    ? `https://everybody.codes/assets/${ctx.group}/${ctx.index}/input.json`
    : `https://everybody.codes/assets/${ctx.group}/${ctx.index}/input/${await getSeed(token)}.json`;
  const response = await ecFetch(url, token);
  return (await response.json()) as Record<string, string>;
}

async function fetchKeys(ctx: PuzzleContext, token: string): Promise<Record<string, string>> {
  const response = await ecFetch(`https://api.everybody.codes/event/${ctx.group}/quest/${ctx.index}`, token);
  return (await response.json()) as Record<string, string>;
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
  solverInputShape: 'parts-dict',
  tokenPrompt:
    "Value of the 'everybody-codes' cookie from everybody.codes — log in, open dev tools → Application/Storage → Cookies.",

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
    return undefined;
  },

  puzzleUrl(ctx) {
    // Confirmed base pattern only (event's quest list) — not deep-linked to a specific quest.
    return `https://everybody.codes/event/${ctx.group}/quests`;
  },

  localInputPath(ctx) {
    // Deliberately outside src/everybodycodes/events/**/inputs/inputs_NN.json: that file is
    // ec.py's own multi-case store (keyed by case id, e.g. "41" for the personal input) and
    // merging into it correctly isn't worth the risk of corrupting existing recorded cases.
    // One file per quest (all parts together), matching ec.py's solver(data: dict) convention.
    const quest = ctx.index.padStart(2, '0');
    return `.puzzle-submitter/everybodycodes/${ctx.group}/quest_${quest}.json`;
  },

  readLocalInput(ctx, folder) {
    return readJsonParts(resolveLocalInputPath(folder, this.localInputPath(ctx)));
  },

  writeLocalInput(ctx, folder, parts) {
    writeJsonParts(resolveLocalInputPath(folder, this.localInputPath(ctx)), parts);
  },

  async fetchInput(ctx, token) {
    // The API hands back every unlocked part's encrypted blob/key in one response each —
    // decrypt whichever parts are actually available rather than just ctx.part.
    const [inputs, keys] = await Promise.all([fetchEncryptedInputs(ctx, token), fetchKeys(ctx, token)]);
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
