export type SiteId = 'aoc' | 'everybodycodes' | 'codyssi' | 'i18n-puzzles' | 'codingquest';

export interface PuzzleContext {
  /** Event year, story number, etc. — whatever the site groups puzzles by. Empty string if the site has none (e.g. i18n-puzzles). */
  group: string;
  /** Day / quest / puzzle number, as it appears in the site's own numbering (not zero-padded). */
  index: string;
  /** 1-based part/level within the puzzle. */
  part: number;
}

export type SubmitStatus = 'correct' | 'incorrect' | 'already-solved' | 'rate-limited' | 'unknown';

export interface SubmitResult {
  status: SubmitStatus;
  message: string;
}

/** Raw input text per part number ("1", "2", "3", ...) — the one local-storage shape
 * every provider reads/writes, regardless of how each site's own API/UI hands it out. */
export type PuzzleInputParts = Record<string, string>;

/** How a site's real solver(data) expects to receive PuzzleInputParts once loaded. */
export type SolverInputShape =
  | 'text' // solver(data: str) — data is the single relevant part's text (aoc, codyssi, i18n-puzzles, codingquest)
  | 'parts-dict'; // solver(data: dict[int, str]) — data is every fetched part at once (everybodycodes)

export interface PuzzleProvider {
  id: SiteId;
  label: string;
  /** Shown when prompting the user to paste their session token. */
  tokenPrompt: string;
  /** Highest part number this site's puzzles have (used for the "next unsolved part" default). */
  maxPart: number;
  /** Highest part number for a SPECIFIC puzzle, when it differs from maxPart (e.g. Advent
   * of Code's last day of the event has only one part, and which day counts as "last"
   * changed starting in 2025). Defaults to maxPart when a provider omits this — read it
   * via core/puzzleParts.ts's maxPartFor() rather than provider.maxPart directly wherever
   * a specific ctx is available. */
  maxPartFor?(ctx: PuzzleContext): number;
  /** What to call one quest/day/puzzle in the tree view, e.g. "Day" -> "Day 5". */
  itemNoun: string;
  /** Human label for a ctx.group value in the tree view, e.g. "gridos-1" -> "GridOS 1".
   * Defaults to the raw group (or "(ungrouped)" if empty) when a provider omits this. */
  groupLabel?(group: string): string;
  /** Infer year/day/quest + a default part from a file path relative to the workspace root. */
  detect(relativeFilePath: string): PuzzleContext | undefined;
  /** Link to the puzzle's page on the site, for a human to open. */
  puzzleUrl(ctx: PuzzleContext): string;
  /** Only implemented by sites with a known submission API (aoc, everybodycodes). Returns
   * every part fetchable in one go, not just the requested one. */
  fetchInput?(ctx: PuzzleContext, token: string, contact: string): Promise<PuzzleInputParts>;
  submit?(ctx: PuzzleContext, token: string, answer: string, contact: string): Promise<SubmitResult>;
  /** Only implemented where the site's own puzzle page displays the confirmed-correct
   * answer for parts you've already solved (aoc: "Your puzzle answer was ..."), even when
   * that solve happened before this extension ever recorded anything. Returns each solved
   * part's answer text in part order (index 0 = part 1), for backfilling progress.ts
   * without re-submitting (which would just get "already solved" back, with no answer
   * text) or trusting whatever the current solver happens to output. */
  fetchRecordedAnswers?(ctx: PuzzleContext, token: string, contact: string): Promise<string[]>;
  /** Set on every site: how its solver(data) wants PuzzleInputParts shaped. Presence of
   * this field is what enables the "Run solver() from this file" runner. */
  solverInputShape?: SolverInputShape;
  /** Only needed when solverInputShape doesn't uniformly apply to everything a provider
   * detects (e.g. Everybody Codes' GridOS, which has no per-quest solver() at all).
   * Defaults to true (whenever solverInputShape is set) when a provider omits this. */
  supportsRunner?(ctx: PuzzleContext): boolean;
}
