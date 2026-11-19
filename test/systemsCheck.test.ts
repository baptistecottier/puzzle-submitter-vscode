import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemsCheckProvider } from '../src/providers/systemsCheck';

const ctx = { group: '', index: '7', part: 1 };

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

test('a mission file is detected, with flat numbering and a link to its page', () => {
  assert.deepEqual(systemsCheckProvider.detect('missions/mission_07.py'), ctx);
  assert.equal(systemsCheckProvider.puzzleUrl(ctx), 'https://systemscheck.dev/missions/7');
  assert.equal(systemsCheckProvider.detect('events/2022/day_07/solver.py'), undefined);
});

test('the input is read with the session cookie and shared by every part', async (t) => {
  const seen: { url?: string; init?: RequestInit } = {};
  stubFetch(t, new Response('t=0 #0 disabled\n', { status: 200 }), seen);
  const parts = await systemsCheckProvider.fetchInput!(ctx, 'abc', 'me');
  assert.deepEqual(parts, { '1': 't=0 #0 disabled', '2': 't=0 #0 disabled' });
  assert.equal(seen.url, 'https://systemscheck.dev/missions/7/input');
  assert.equal((seen.init?.headers as Record<string, string>).Cookie, 'session=abc');
});

test('a redirect to the login page is reported as an expired session, not saved as input', async (t) => {
  stubFetch(t, new Response(null, { status: 303, headers: { Location: '/login' } }));
  await assert.rejects(systemsCheckProvider.fetchInput!(ctx, 'old', 'me'), /session cookie has expired/);
});

test('a mission outside the locator table gets its first input-shaped block, without an answer', async (t) => {
  const page = '<article class="mission-doc"><pre><code>┌──┐\n│a │\n└──┘\n</code></pre><pre><code>t=0 #0 disabled\n</code></pre></article>';
  stubFetch(t, new Response(page, { status: 200 }));
  const { examples } = await systemsCheckProvider.fetchExamples!({ ...ctx, index: '99' }, '', 'me');
  assert.deepEqual(examples, [{ input_data: 't=0 #0 disabled' }]);
});

test('a listed mission reads its example input and answer from the positions in the table', async (t) => {
  // mission 2: input is the 1st <pre>, answer the 4th <code> outside <pre> blocks
  const page =
    '<article class="mission-doc"><p><code>.</code><code>#</code><code>*</code></p><pre><code>a\n..\n</code></pre>' +
    '<p><code>32</code></p></article>';
  stubFetch(t, new Response(page, { status: 200 }));
  const { examples } = await systemsCheckProvider.fetchExamples!({ ...ctx, index: '2' }, '', 'me');
  assert.deepEqual(examples, [{ input_data: 'a\n..', answer_a: '32' }]);
});
