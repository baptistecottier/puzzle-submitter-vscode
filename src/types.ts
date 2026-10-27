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

/** One worked example from a puzzle's prose, in aocd's own Example shape (aocd's
 * Example tuple: input_data, answer_a, answer_b, extra). Answers are per part: answer_a for part 1, answer_b for part 2. */
export interface PuzzleExample {
  input_data: string;
  answer_a?: string;
  answer_b?: string;
  /** Part 3's answer — not in aocd's shape (AoC has two parts), used by Everybody Codes. */
  answer_c?: string;
  /** Extra context some examples need (e.g. fewer iterations than the real input) —
   * not passed to solver(), only shown next to a failing result as a hint. */
  extra?: Record<string, unknown>;
}

/** What a site's description showed when examples were fetched: the examples, and how
 * many parts' text was visible (later parts unlock as earlier ones are solved). */
export interface FetchedExamples {
  examples: PuzzleExample[];
  parts: number;
}

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
  /** Sort key for ordering groups in the tree/sync — needed whenever a provider's groups
   * aren't all the same shape (e.g. Everybody Codes mixes 4-digit years, small story
   * numbers, and "gridos-N"), since a plain string/numeric sort on the raw group would
   * interleave them (story "3" sorts between years "2024" and "2025"). Compared with
   * plain string comparison, so build it so ascending order gives the desired grouping
   * (e.g. a category prefix followed by a zero-padded number). Defaults to the raw group
   * value (equivalent to a plain sort) when a provider omits this. */
  groupSortKey?(group: string): string;
  /** Infer year/day/quest + a default part from a file path relative to the workspace root. */
  detect(relativeFilePath: string): PuzzleContext | undefined;
  /** Link to the puzzle's page on the site, for a human to open. */
  puzzleUrl(ctx: PuzzleContext): string;
  /** Only implemented by sites with a known submission API (aoc, everybodycodes). Returns
   * every part fetchable in one go, not just the requested one. An input that isn't text
   * (an image) is stored with saveFile, and its workspace-relative path is the input. */
  fetchInput?(ctx: PuzzleContext, token: string, contact: string, saveFile?: SaveInputFile): Promise<PuzzleInputParts>;
  submit?(ctx: PuzzleContext, token: string, answer: string, contact: string): Promise<SubmitResult>;
  /** Only implemented where the site's own puzzle page displays the confirmed-correct
   * answer for parts you've already solved (aoc: "Your puzzle answer was ..."), even when
   * that solve happened before this extension ever recorded anything. Returns each solved
   * part's answer text in part order (index 0 = part 1), for backfilling progress.ts
   * without re-submitting (which would just get "already solved" back, with no answer
   * text) or trusting whatever the current solver happens to output. */
  fetchRecordedAnswers?(ctx: PuzzleContext, token: string, contact: string): Promise<string[]>;
  /** Only for sites whose answers are the same for everyone and published openly
   * (codingquest). They're a reference to check against — unlike fetchRecordedAnswers,
   * which reads back what *you* solved, having one doesn't mean the part is solved (see
   * core/publishedAnswers.ts). No token. Answers in part order. */
  fetchPublishedAnswers?(ctx: PuzzleContext, contact: string): Promise<string[]>;
  /** Set on every site: how its solver(data) wants PuzzleInputParts shaped. Presence of
   * this field is what enables the "Run solver() from this file" runner. */
  solverInputShape?: SolverInputShape;
  /** Only implemented where a puzzle's worked examples (input + expected answers) can be
   * located in its description: aoc (aocd's per-puzzle locators) and everybodycodes (see
   * providers/ecExamples.ts). Enables "Fetch Examples" and caching them on Sync —
   * "Run on Examples" itself works on any site with examples added to the cache by hand
   * (see core/examples.ts). */
  fetchExamples?(ctx: PuzzleContext, token: string, contact: string): Promise<FetchedExamples>;
  /** Only needed when solverInputShape doesn't uniformly apply to everything a provider
   * detects (e.g. Everybody Codes' GridOS, which has no per-quest solver() at all).
   * Defaults to true (whenever solverInputShape is set) when a provider omits this. */
  supportsRunner?(ctx: PuzzleContext): boolean;
  /** Canonical workspace-relative .py path for a puzzle — the inverse of detect(), used
   * by the tree's "New Event" scaffolding action. Only implemented by sites with a real
   * grouped-event structure (not i18n-puzzles, which is flat and has no such concept). */
  scaffoldPath?(ctx: PuzzleContext): string;
}

/** Stores a downloaded input file in the workspace's cache; returns its workspace-relative
 * path, which is what the solver gets as its input (the solver runs from the workspace root). */
export type SaveInputFile = (name: string, data: Uint8Array) => string;

/** An input fetch that can't produce text, but knows where the input is — e.g. a puzzle
 * whose input is an image. Its links become buttons on the error notification. */
export class InputElsewhereError extends Error {
  constructor(message: string, readonly links: { label: string; url: string }[]) {
    super(message);
  }
}
