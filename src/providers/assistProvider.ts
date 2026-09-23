import { PuzzleProvider, SiteId } from '../types';

/**
 * Shared shape for sites with no known submission API: no fetchInput/submit, just
 * enough to detect the puzzle and open its page. The submit command falls back to
 * copying the answer to the clipboard for these. See README "Known limitations".
 */
function createAssistProvider(config: {
  id: SiteId;
  label: string;
  detectRe: RegExp;
  group: (match: RegExpExecArray) => string;
  index: (match: RegExpExecArray) => string;
  puzzleUrl: PuzzleProvider['puzzleUrl'];
}): PuzzleProvider {
  return {
    id: config.id,
    label: config.label,
    maxPart: 1,
    tokenPrompt: `${config.label} has no known submission API, so no token is used here.`,
    detect(relativeFilePath) {
      const match = config.detectRe.exec(relativeFilePath);
      if (!match) return undefined;
      return { group: config.group(match), index: config.index(match), part: 1 };
    },
    puzzleUrl: config.puzzleUrl,
  };
}

export const codyssiProvider = createAssistProvider({
  id: 'codyssi',
  label: 'Codyssi',
  detectRe: /events\/year_(\d{4})\/day_(\d{2})\//,
  group: (m) => m[1],
  index: (m) => String(Number(m[2])),
  // No confirmed per-day URL — links to the challenges list. Tell Claude a real day
  // URL (e.g. from your browser's address bar) and this can be sharpened.
  puzzleUrl: () => 'https://www.codyssi.com/challenges_page',
});

export const i18nPuzzlesProvider = createAssistProvider({
  id: 'i18n-puzzles',
  label: 'i18n-puzzles',
  detectRe: /problems\/problem_(\d{2})\//,
  group: () => '', // flat numbering, no year/group on this site
  index: (m) => String(Number(m[1])),
  puzzleUrl: (ctx) => `https://i18n-puzzles.com/puzzle/${ctx.index}/`,
});

export const codingQuestProvider = createAssistProvider({
  id: 'codingquest',
  label: 'Coding Quest',
  detectRe: /events\/(challenge|practice)_(\d{4})\/day_(\d{2})\//,
  // Challenge and practice are separate tracks for the same year, so both are kept in
  // "group" to avoid conflating their progress — a configured runCommand's ${year}
  // placeholder receives e.g. "challenge_2024" here, not a bare year.
  group: (m) => `${m[1]}_${m[2]}`,
  index: (m) => String(Number(m[3])),
  // codingquest.io problem pages use a flat global number unrelated to year/day, which
  // isn't derivable from the local folder layout — links to the homepage instead.
  puzzleUrl: () => 'https://codingquest.io',
});
