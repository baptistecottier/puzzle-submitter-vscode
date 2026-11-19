import { test } from 'node:test';
import assert from 'node:assert/strict';
import { i18nPuzzlesProvider, parseI18nRecordedAnswer, parseI18nResponse } from '../src/providers/i18nPuzzles';

const ctx = { group: '', index: '3', part: 1 };

function stubFetch(t: { after(fn: () => void): void }, response: Response, seen?: { url?: string; init?: RequestInit }): void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (seen) Object.assign(seen, { url, init });
    return response;
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = real;
  });
}

test('i18n-puzzles asks for a session cookie, since inputs are personal', () => {
  assert.equal(i18nPuzzlesProvider.usesToken, true);
  assert.match(i18nPuzzlesProvider.tokenPrompt, /sessionid/);
});

test('the input is read with the sessionid cookie', async (t) => {
  const seen: { url?: string; init?: RequestInit } = {};
  stubFetch(t, new Response('héllo\nwörld\n', { status: 200 }), seen);
  const parts = await i18nPuzzlesProvider.fetchInput!(ctx, 'abc', 'me');
  assert.deepEqual(parts, { '1': 'héllo\nwörld' });
  assert.equal(seen.url, 'https://i18n-puzzles.com/puzzle/3/input');
  assert.equal((seen.init?.headers as Record<string, string>).Cookie, 'sessionid=abc');
});

test('a 401 is reported as an expired session, not saved as input', async (t) => {
  stubFetch(t, new Response('Requires authentication', { status: 401 }));
  await assert.rejects(i18nPuzzlesProvider.fetchInput!(ctx, 'old', 'me'), /session cookie/);
});

// The real response to a wrong answer (puzzle 1, answer "0"), trimmed to the part that matters.
const WRONG = `</nav>

<p><b>That is not the correct answer.</b>
If you're stuck, you can ask for hints on the <a href="https://www.reddit.com/r/i18n_puzzles/">subreddit</a>
or on the <a href="https://discord.gg/eVxAz2zjn5">Discord server</a>.
Please wait a minute before submitting again.
</p>`;

test('a wrong answer is recognized, with the wait it asks for', () => {
  assert.deepEqual(parseI18nResponse(WRONG), {
    status: 'incorrect',
    message: 'That is not the correct answer. Please wait a minute before submitting again.',
  });
});

test("a verdict that isn't recognized is passed through in the site's own words", () => {
  const result = parseI18nResponse('</nav><p><b>You are submitting too fast.</b></p>');
  assert.deepEqual(result, { status: 'unknown', message: 'i18n-puzzles said: You are submitting too fast.' });
});

test('submitting reads the CSRF token from the puzzle page, then posts the form', async (t) => {
  const real = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (calls.length === 1) {
      return new Response(
        '<form action = "/puzzle/3/submit" method = "POST"><input type="hidden" name="csrfmiddlewaretoken" value="FORMTOK">',
        { status: 200, headers: { 'Set-Cookie': 'csrftoken=COOKTOK; Path=/; SameSite=Lax' } },
      );
    }
    return new Response(WRONG, { status: 200 });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = real;
  });
  const result = await i18nPuzzlesProvider.submit!(ctx, 'abc', '42 €', 'me');
  assert.equal(result.status, 'incorrect');
  assert.equal(calls[1].url, 'https://i18n-puzzles.com/puzzle/3/submit');
  assert.equal(calls[1].init?.method, 'POST');
  const sent = calls[1].init?.headers as Record<string, string>;
  assert.equal(sent.Cookie, 'sessionid=abc; csrftoken=COOKTOK');
  assert.equal(sent.Referer, 'https://i18n-puzzles.com/puzzle/3/');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(String(calls[1].init?.body))), { csrfmiddlewaretoken: 'FORMTOK', answer: '42 €' });
});

test('a logged-out puzzle page is reported as an expired session, and nothing is posted', async (t) => {
  let posts = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') posts++;
    return new Response('<p>To play, please log in with one of these options:</p>', { status: 200 });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = real;
  });
  await assert.rejects(i18nPuzzlesProvider.submit!(ctx, 'old', '1', 'me'), /session cookie/);
  assert.equal(posts, 0);
});

test("a solved puzzle's recorded answer is read back, whatever tags wrap it", () => {
  assert.equal(parseI18nRecordedAnswer('<p>Your puzzle answer was: 107989</p>'), '107989');
  assert.equal(parseI18nRecordedAnswer('<p>Your puzzle answer was: <code>107989</code></p>'), '107989');
  assert.equal(parseI18nRecordedAnswer('<p>Your puzzle answer was\n  <b><code>Ü-42</code></b></p>'), 'Ü-42');
  assert.equal(parseI18nRecordedAnswer('<form action="/puzzle/1/submit">'), undefined);
});

test('submitting to a solved puzzle reports it as already solved, and nothing is posted', async (t) => {
  let posts = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') posts++;
    return new Response('<nav><form action="/logout/"></form></nav><p>Your puzzle answer was: 107989</p>', { status: 200 });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = real;
  });
  assert.equal((await i18nPuzzlesProvider.submit!(ctx, 'abc', '1', 'me')).status, 'already-solved');
  assert.deepEqual(await i18nPuzzlesProvider.fetchRecordedAnswers!(ctx, 'abc', 'me'), ['107989']);
  assert.equal(posts, 0);
});
