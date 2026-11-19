import { PuzzleProvider } from '../types';
import { extractSystemsCheckExamples } from './systemsCheckExamples';

const SITE = 'https://systemscheck.dev';

/** Systems Check has no API, only its web pages, and one input per mission shared by all
 * its parts. Missions open one at a time, with no events, so they sit in one flat folder:
 * missions/mission_NN.py. Logged out, a mission's input redirects to /login rather than failing. */
export const systemsCheckProvider: PuzzleProvider = {
  id: 'systemscheck',
  label: 'Systems Check',
  maxPart: 2,
  itemNoun: 'Mission',
  solverInputShape: 'text',
  usesToken: true,
  tokenPrompt: "Value of the 'session' cookie from systemscheck.dev — log in, open dev tools → Application/Storage → Cookies.",

  detect(relativeFilePath) {
    const match = /missions\/mission_(\d{2,})\.py$/.exec(relativeFilePath);
    return match ? { group: '', index: String(Number(match[1])), part: 1 } : undefined;
  },

  puzzleUrl: (ctx) => `${SITE}/missions/${ctx.index}`,

  async fetchInput(ctx, token, contact) {
    const response = await fetch(`${SITE}/missions/${ctx.index}/input`, {
      redirect: 'manual',
      headers: {
        Cookie: `session=${token}`,
        'User-Agent': `puzzle-submitter-vscode (${contact.trim() || 'contact not configured'})`,
      },
    });
    if (response.status >= 300 && response.status < 400) {
      throw new Error('Systems Check sent us to its login page — your session cookie has expired; clear the token and set a new one.');
    }
    if (!response.ok) throw new Error(`Systems Check returned HTTP ${response.status} for mission ${ctx.index}'s input.`);
    const text = (await response.text()).replace(/\n$/, '');
    return { '1': text, '2': text };
  },

  // The mission page is public, so no token is needed to read it.
  async fetchExamples(ctx, _token, contact) {
    const response = await fetch(`${SITE}/missions/${ctx.index}`, {
      headers: { 'User-Agent': `puzzle-submitter-vscode (${contact.trim() || 'contact not configured'})` },
    });
    if (!response.ok) throw new Error(`Systems Check returned HTTP ${response.status} for mission ${ctx.index}.`);
    return extractSystemsCheckExamples(await response.text(), Number(ctx.index));
  },
};
