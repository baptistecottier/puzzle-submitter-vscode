import { PuzzleProvider, SiteId } from '../types';
import { codingQuestPuzzleUrl, fetchCodingQuestAnswers, fetchCodingQuestInput } from './codingQuestAnswers';

export { codingQuestPuzzleUrl };

/**
 * Shared shape for sites with no known submission API: no fetchInput/submit, just
 * enough to detect the puzzle, open its page, and (via "Set Input", since there's no
 * fetch API) let the runner work the same way it does for aoc/everybodycodes. The
 * submit command falls back to copying the answer to the clipboard. See README
 * "Known limitations".
 */
function createAssistProvider(config: {
  id: SiteId;
  label: string;
  itemNoun: string;
  detectRe: RegExp;
  group: (match: RegExpExecArray) => string;
  index: (match: RegExpExecArray) => string;
  puzzleUrl: PuzzleProvider['puzzleUrl'];
  /** Omitted for sites with no real grouped-event structure (i18n-puzzles) — "New Event" won't offer them. */
  scaffoldPath?: PuzzleProvider['scaffoldPath'];
  fetchPublishedAnswers?: PuzzleProvider['fetchPublishedAnswers'];
  fetchInput?: PuzzleProvider['fetchInput'];
}): PuzzleProvider {
  return {
    id: config.id,
    label: config.label,
    maxPart: 1,
    itemNoun: config.itemNoun,
    solverInputShape: 'text',
    tokenPrompt: `${config.label} has no known submission API, so no token is used here.`,
    detect(relativeFilePath) {
      const match = config.detectRe.exec(relativeFilePath);
      if (!match) return undefined;
      return { group: config.group(match), index: config.index(match), part: 1 };
    },
    puzzleUrl: config.puzzleUrl,
    scaffoldPath: config.scaffoldPath,
    fetchPublishedAnswers: config.fetchPublishedAnswers,
    fetchInput: config.fetchInput,
  };
}

export const codyssiProvider = createAssistProvider({
  id: 'codyssi',
  label: 'Codyssi',
  itemNoun: 'Day',
  detectRe: /events\/year_(\d{4})\/day_(\d{2})\//,
  group: (m) => m[1],
  index: (m) => String(Number(m[2])),
  // No confirmed per-day URL — links to the challenges list. Tell Claude a real day
  // URL (e.g. from your browser's address bar) and this can be sharpened.
  puzzleUrl: () => 'https://www.codyssi.com/challenges_page',
  scaffoldPath: (ctx) => {
    const day = ctx.index.padStart(2, '0');
    return `events/year_${ctx.group}/day_${day}/day_${day}.py`;
  },
});

export const i18nPuzzlesProvider = createAssistProvider({
  id: 'i18n-puzzles',
  label: 'i18n-puzzles',
  itemNoun: 'Puzzle',
  detectRe: /problems\/problem_(\d{2})\//,
  group: () => '', // flat numbering, no year/group on this site
  index: (m) => String(Number(m[1])),
  puzzleUrl: (ctx) => `https://i18n-puzzles.com/puzzle/${ctx.index}/`,
});

export const codingQuestProvider = createAssistProvider({
  id: 'codingquest',
  label: 'Coding Quest',
  itemNoun: 'Day',
  // Editions as the archive names them: events/2022 … events/2024, and events/prequel
  // (2022's warm-up). The older challenge_YYYY / practice_2022 folder names still work.
  detectRe: /events\/(?:challenge_)?(\d{4}|prequel|practice_2022)\/day_(\d{2})\//,
  group: (m) => (m[1] === 'practice_2022' ? 'prequel' : m[1]),
  index: (m) => String(Number(m[2])),
  // codingquest.io is gone; the event lives on in its author's archive, one page per day.
  puzzleUrl: codingQuestPuzzleUrl,
  scaffoldPath: (ctx) => {
    const day = ctx.index.padStart(2, '0');
    return `events/${ctx.group}/day_${day}/day_${day}.py`;
  },
  // Inputs and answers are the same for everyone, and published in the event's archive.
  fetchPublishedAnswers: fetchCodingQuestAnswers,
  fetchInput: fetchCodingQuestInput,
});
